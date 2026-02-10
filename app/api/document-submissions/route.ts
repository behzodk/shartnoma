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

function getInitDataFromRequest(request: Request) {
  const { searchParams } = new URL(request.url)
  return searchParams.get("initData") || request.headers.get("x-telegram-init") || undefined
}

export async function GET(request: Request) {
  try {
    const initData = getInitDataFromRequest(request)

    if (!initData || !process.env.TELEGRAM_BOT_TOKEN) {
      return NextResponse.json({ exists: false })
    }

    const { valid, userId } = validateTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)
    if (!valid || !userId) {
      return NextResponse.json({ exists: false })
    }

    const { data, error } = await supabase
      .from("document_submissions")
      .select("id, first_name, last_name, university, program, doc_path")
      .eq("telegram_chat_id", userId)
      .limit(1)

    if (error) {
      console.error("Supabase select error (GET)", error)
      return NextResponse.json({ message: "Tekshirishda xatolik" }, { status: 500 })
    }

    const exists = !!data && data.length > 0
    const submission = exists
      ? {
          firstName: data[0].first_name,
          lastName: data[0].last_name,
          university: data[0].university,
          program: data[0].program,
          docPath: data[0].doc_path,
        }
      : null

    return NextResponse.json({ exists, submission })
  } catch (error) {
    console.error("GET error", error)
    return NextResponse.json({ message: "Unexpected error" }, { status: 500 })
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

      // Hard block duplicates server-side
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
        return NextResponse.json({ message: "Siz allaqachon topshirdingiz" }, { status: 409 })
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

export async function PUT(request: Request) {
  try {
    const formData = await request.formData()
    const initData = formData.get("initData")?.toString()
    if (!initData || !process.env.TELEGRAM_BOT_TOKEN) {
      return NextResponse.json({ message: "Telegram ma'lumotlari kerak" }, { status: 400 })
    }

    const { valid, userId } = validateTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)
    if (!valid || !userId) {
      return NextResponse.json({ message: "Telegram ma'lumotlari tasdiqlanmadi" }, { status: 401 })
    }

    const firstName = formData.get("firstName")?.toString()
    const lastName = formData.get("lastName")?.toString()
    const university = formData.get("university")?.toString()
    const program = formData.get("program")?.toString()
    const document = formData.get("document")

    if (!firstName || !lastName || !university || !program) {
      return NextResponse.json({ message: "Majburiy maydonlar to'ldirilmagan" }, { status: 400 })
    }

    const { data: existing, error: selectError } = await supabase
      .from("document_submissions")
      .select("id, doc_path")
      .eq("telegram_chat_id", userId)
      .limit(1)

    if (selectError) {
      console.error("Supabase select error (PUT)", selectError)
      return NextResponse.json({ message: "Tekshirishda xatolik" }, { status: 500 })
    }

    if (!existing || existing.length === 0) {
      return NextResponse.json({ message: "Topilmadi" }, { status: 404 })
    }

    let docPath = existing[0].doc_path as string | null

    if (document instanceof File) {
      const safeFileName = document.name.replace(/[^a-zA-Z0-9.-]/g, "_")
      const filePath = `documents/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeFileName}`
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("shartnoma_zip")
        .upload(filePath, document, {
          contentType: document.type || "application/zip",
          upsert: false,
        })

      if (uploadError || !uploadData?.path) {
        console.error("Supabase upload error (PUT)", uploadError)
        return NextResponse.json({ message: "Faylni yuklashda xatolik" }, { status: 500 })
      }
      docPath = uploadData.path
    }

    const { error: updateError } = await supabase
      .from("document_submissions")
      .update({
        first_name: firstName,
        last_name: lastName,
        university,
        program,
        doc_path: docPath,
      })
      .eq("telegram_chat_id", userId)

    if (updateError) {
      console.error("Supabase update error", updateError)
      return NextResponse.json({ message: "Yangilashda xatolik" }, { status: 500 })
    }

    return NextResponse.json({ ok: true, docPath })
  } catch (error) {
    console.error("PUT error", error)
    return NextResponse.json({ message: "Unexpected error" }, { status: 500 })
  }
}
