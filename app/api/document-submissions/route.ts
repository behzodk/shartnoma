import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Supabase credentials are not configured")
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

export async function POST(request: Request) {
  try {
    const formData = await request.formData()

    const firstName = formData.get("firstName")?.toString()
    const lastName = formData.get("lastName")?.toString()
    const university = formData.get("university")?.toString()
    const program = formData.get("program")?.toString()
    const document = formData.get("document")

    if (!firstName || !lastName || !university || !program || !(document instanceof File)) {
      return NextResponse.json({ message: "Missing required fields" }, { status: 400 })
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
