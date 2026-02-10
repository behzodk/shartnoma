import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import crypto from "crypto"

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Supabase credentials are not configured")
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

function validateTelegramInitData(initData: string, botToken: string) {
  try {
    const params = new URLSearchParams(initData)
    const hash = params.get("hash")
    if (!hash) return { valid: false, userId: null }

    // data_check_string: sorted key=value lines excluding hash
    const pairs: string[] = []
    params.forEach((value, key) => {
      if (key === "hash") return
      pairs.push(`${key}=${value}`)
    })
    const dataCheckString = pairs.sort().join("\n")

    // Telegram WebApp: secret key = HMAC_SHA256("WebAppData", botToken)
    const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest()
    const computed = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex")

    const valid =
      computed.length === hash.length &&
      crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(hash, "hex"))

    if (!valid) return { valid: false, userId: null }

    const userParam = params.get("user")
    if (!userParam) return { valid: true, userId: null }
    const parsedUser = JSON.parse(userParam)
    const userId = typeof parsedUser?.id === "number" ? parsedUser.id : null

    return { valid: true, userId }
  } catch (err) {
    console.error("Init data validation error", err)
    return { valid: false, userId: null }
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()

    const firstName = formData.get("firstName")?.toString()
    const lastName = formData.get("lastName")?.toString()
    const university = formData.get("university")?.toString()
    const program = formData.get("program")?.toString()
    const document = formData.get("document")
    const initData = formData.get("initData")?.toString()

    if (!firstName || !lastName || !university || !program || !(document instanceof File)) {
      return NextResponse.json({ message: "Missing required fields" }, { status: 400 })
    }

    let telegramUserId: number | null = null

    if (initData && process.env.TELEGRAM_BOT_TOKEN) {
      const { valid, userId } = validateTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)
      if (!valid) {
        return NextResponse.json({ message: "Telegram ma'lumotlari tasdiqlanmadi" }, { status: 401 })
      }
      if (!userId) {
        return NextResponse.json({ message: "Telegram foydalanuvchisi aniqlanmadi" }, { status: 400 })
      }
      telegramUserId = userId

      if (telegramUserId) {
        const { data: existing, error: selectError } = await supabase
          .from("document_submissions")
          .select("id")
          .eq("telegram_chat_id", telegramUserId)
          .limit(1)

        if (selectError) {
          console.error("Supabase select error", selectError)
          return NextResponse.json({ message: "Tekshirishda xatolik" }, { status: 500 })
        }

        if (existing && existing.length > 0) {
          return NextResponse.json({ message: "Bu Telegram hisobidan allaqachon yuborilgan" }, { status: 409 })
        }
      }
    }

    const safeFileName = document.name.replace(/[^a-zA-Z0-9.-]/g, "_")
    const filePath = `documents/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeFileName}`

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("shartnoma_zip")
      .upload(filePath, document, {
        contentType: document.type || "application/zip",
        upsert: false,
      })

    if (uploadError || !uploadData?.path) {
      console.error("Supabase upload error", uploadError)
      return NextResponse.json({ message: "Failed to upload document" }, { status: 500 })
    }

    const { error } = await supabase.from("document_submissions").insert({
      first_name: firstName,
      last_name: lastName,
      university,
      program,
      doc_path: uploadData.path,
      telegram_chat_id: telegramUserId,
    })

    if (error) {
      console.error("Supabase insert error", error)
      return NextResponse.json({ message: "Failed to save submission" }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("API error", error)
    return NextResponse.json({ message: "Unexpected error" }, { status: 500 })
  }
}
