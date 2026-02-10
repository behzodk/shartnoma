"use client"

import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { ArrowRight, ArrowLeft, Check, User, GraduationCap, Loader2, Upload } from "lucide-react"
import Script from "next/script"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StepIndicator } from "@/components/step-indicator"
import { FormHeader } from "@/components/form-header"
import { cn } from "@/lib/utils"

type TelegramWebApp = {
  ready: () => void
  expand: () => void
  initData?: string
  initDataUnsafe?: { user?: { id?: number } }
  themeParams?: Partial<Record<"bg_color" | "text_color" | "button_color" | "button_text_color", string>>
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

const documentSchema = z
  .custom<File>((val) => val instanceof File, { message: "Fayl yuklang" })
  .refine((file) => file && file.name.toLowerCase().endsWith(".zip"), {
    message: ".zip faylini yuklang",
  })

const formSchema = z.object({
  firstName: z.string().min(2, "Ism kamida 2 ta harf bo'lishi kerak"),
  lastName: z.string().min(2, "Familiya kamida 2 ta harf bo'lishi kerak"),
  university: z.string().min(2, "Universitet nomi talab qilinadi"),
  program: z.enum(["bachelors", "masters", "phd"], {
    required_error: "Dastur turini tanlang",
  }),
  document: documentSchema.optional(),
})

type FormData = z.infer<typeof formSchema>

type ExistingSubmission = {
  firstName: string
  lastName: string
  university: string
  program: "bachelors" | "masters" | "phd"
  docPath: string | null
}

export function SubmissionForm() {
  const [step, setStep] = useState(0)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [alreadySubmitted, setAlreadySubmitted] = useState(false)
  const [checkingExisting, setCheckingExisting] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [initData, setInitData] = useState<string | null>(null)
  const [telegramUserId, setTelegramUserId] = useState<number | null>(null)
  const [isTelegram, setIsTelegram] = useState(false)
  const [tgReady, setTgReady] = useState(false)
  const [scriptLoaded, setScriptLoaded] = useState(false)
  const [existingSubmission, setExistingSubmission] = useState<ExistingSubmission | null>(null)
  const [editingExisting, setEditingExisting] = useState(false)

  const {
    register,
    handleSubmit,
    trigger,
    setValue,
    setError,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      university: "",
      document: undefined as unknown as File,
    },
  })

  const programValue = watch("program")
  const documentValue = watch("document")
  const documentRegister = register("document")

  // Detect Telegram WebApp context (retry while the SDK becomes available)
  useEffect(() => {
    const initTelegram = () => {
      const tg = window.Telegram?.WebApp
      if (!tg) return false

      tg.ready()
      tg.expand()
      setIsTelegram(true)
      setInitData(tg.initData || null)
      const uid = tg.initDataUnsafe?.user?.id
      setTelegramUserId(typeof uid === "number" ? uid : null)
      setTgReady(true)

      if (tg.themeParams) {
        const root = document.documentElement
        if (tg.themeParams.bg_color) root.style.setProperty("--tg-bg-color", tg.themeParams.bg_color)
        if (tg.themeParams.text_color) root.style.setProperty("--tg-text-color", tg.themeParams.text_color)
        if (tg.themeParams.button_color) root.style.setProperty("--tg-button-color", tg.themeParams.button_color)
        if (tg.themeParams.button_text_color)
          root.style.setProperty("--tg-button-text-color", tg.themeParams.button_text_color)
      }
      return true
    }

    if (!scriptLoaded) return
    if (initTelegram()) return

    const interval = setInterval(() => {
      if (initTelegram()) clearInterval(interval)
    }, 250)
    const timeout = setTimeout(() => clearInterval(interval), 4000)
    return () => {
      clearInterval(interval)
      clearTimeout(timeout)
    }
  }, [scriptLoaded])

  const onSubmit = async (_data: FormData) => {
    setError(null)
    setIsSubmitting(true)

    if (!existingSubmission && !_data.document) {
      setError("document", { type: "manual", message: "Fayl yuklang" })
      setIsSubmitting(false)
      return
    }

    try {
      const formData = new FormData()
      formData.append("firstName", _data.firstName)
      formData.append("lastName", _data.lastName)
      formData.append("university", _data.university)
      formData.append("program", _data.program)
      if (_data.document) {
        formData.append("document", _data.document)
      }
      formData.append("initData", initData || "")

      const isUpdate = !!existingSubmission
      const response = await fetch("/api/document-submissions", {
        method: isUpdate ? "PUT" : "POST",
        body: formData,
      })

      const resJson = await response.json().catch(() => ({}))

      if (!response.ok) {
        if (response.status === 409) {
          setAlreadySubmitted(true)
          throw new Error(resJson.message || "Siz allaqachon topshirdingiz")
        }
        throw new Error(resJson.message || "Yuborishda xatolik yuz berdi")
      }

      setIsSubmitted(true)
      if (isUpdate) {
        setExistingSubmission({
          firstName: _data.firstName,
          lastName: _data.lastName,
          university: _data.university,
          program: _data.program,
          docPath: resJson.docPath ?? existingSubmission?.docPath ?? null,
        })
        setEditingExisting(false)
        setAlreadySubmitted(true)
      }
    } catch (err) {
      console.error(err)
      const friendly = err instanceof Error ? err.message : "Xatolik yuz berdi. Iltimos, qayta urinib ko'ring."
      setError(friendly)
    } finally {
      setIsSubmitting(false)
    }
  }

  const nextStep = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    let valid = false
    if (step === 0) {
      valid = await trigger(["firstName", "lastName"])
    } else if (step === 1) {
      valid = await trigger(["university", "program"])
    }
    if (valid) setStep((s) => Math.min(s + 1, 2))
  }

  const prevStep = () => {
    setStep((s) => Math.max(s - 1, 0))
  }

  // If Telegram + initData available, check if already submitted to avoid showing form
  useEffect(() => {
    const shouldCheck = isTelegram && tgReady && initData
    if (!shouldCheck) return

    const controller = new AbortController()
    setCheckingExisting(true)
    fetch(`/api/document-submissions?initData=${encodeURIComponent(initData!)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("Tekshirishda xatolik")
        const data = await res.json()
        if (data?.exists) {
          setAlreadySubmitted(true)
          if (data.submission) {
            setExistingSubmission({
              firstName: data.submission.firstName,
              lastName: data.submission.lastName,
              university: data.submission.university,
              program: data.submission.program,
              docPath: data.submission.docPath ?? null,
            })
            setValue("firstName", data.submission.firstName)
            setValue("lastName", data.submission.lastName)
            setValue("university", data.submission.university)
            setValue("program", data.submission.program)
          }
        }
      })
      .catch((err) => {
        console.error(err)
      })
      .finally(() => setCheckingExisting(false))

    return () => controller.abort()
  }, [initData, isTelegram, tgReady])

  if (alreadySubmitted && !editingExisting && existingSubmission) {
    return (
      <div className="flex min-h-[100svh] items-center justify-center bg-background p-4">
        <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-2xl border border-border bg-card p-8 shadow-lg shadow-foreground/5 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Check className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">Siz allaqachon topshirdingiz</h2>
          <div className="w-full text-left text-sm text-muted-foreground space-y-2">
            <p><span className="font-medium text-foreground">Ism:</span> {existingSubmission.firstName}</p>
            <p><span className="font-medium text-foreground">Familiya:</span> {existingSubmission.lastName}</p>
            <p><span className="font-medium text-foreground">Universitet:</span> {existingSubmission.university}</p>
            <p><span className="font-medium text-foreground">Dastur:</span> {existingSubmission.program}</p>
            {existingSubmission.docPath && (
              <p className="break-all">
                <span className="font-medium text-foreground">Yuklangan fayl:</span> {existingSubmission.docPath}
              </p>
            )}
          </div>
          <Button className="w-full h-12 rounded-xl text-sm font-medium" onClick={() => setEditingExisting(true)}>
            Tahrirlash
          </Button>
        </div>
      </div>
    )
  }

  if (isSubmitted) {
    return (
      <div className="flex min-h-[100svh] items-center justify-center bg-background p-4">
        <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-2xl border border-border bg-card p-8 shadow-lg shadow-foreground/5">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Check className="h-8 w-8 text-primary" />
          </div>
          <div className="flex flex-col items-center gap-2 text-center">
            <h2 className="text-xl font-semibold text-foreground">
              Arizangiz qabul qilindi
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Ma'lumotlaringiz qabul qilindi. Yangilash kerak bo'lsa, qayta yuborishingiz mumkin.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-[100svh] items-center justify-center bg-background p-3 sm:p-4">
      <div className="flex w-full max-w-md flex-col gap-6">
        <FormHeader />
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="afterInteractive"
          onLoad={() => setScriptLoaded(true)}
        />

        <div className="rounded-2xl border border-border bg-card p-6 shadow-lg shadow-foreground/5">
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Bosqich {step + 1} / 3
              </span>
              <span className="text-xs font-medium text-primary">
                {step === 0 ? "Shaxsiy ma'lumotlar" : step === 1 ? "Akademik ma'lumotlar" : "Hujjat"}
              </span>
            </div>

            <StepIndicator currentStep={step} totalSteps={3} />

            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
              <input type="hidden" name="initData" value={initData ?? ""} />

              {telegramUserId && (
                <p className="text-xs text-muted-foreground px-1">
                  Telegram ID: {telegramUserId}
                </p>
              )}

              {isTelegram && tgReady && !initData && (
                <div className="rounded-xl border border-dashed border-amber-500/60 bg-amber-50/70 px-4 py-3 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                  Telegram sessiyasi aniqlanmadi. Ilovani qayta oching yoki ruxsat bering.
                </div>
              )}

              {/* Step 1: Personal Info */}
              <div
                className={cn(
                  "flex flex-col gap-5 transition-all duration-300",
                  step === 0
                    ? "opacity-100 translate-y-0"
                    : "hidden opacity-0 translate-y-4"
                )}
              >
                <div className="flex items-center gap-2 text-muted-foreground">
                  <User className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wider">
                    Shaxsiy ma'lumotlar
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="firstName" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Ism
                  </Label>
                  <Input
                    id="firstName"
                    placeholder="Ismingiz"
                    className="h-12 rounded-xl border-border bg-muted/50 px-4 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0"
                    {...register("firstName")}
                    aria-invalid={!!errors.firstName}
                    aria-describedby={errors.firstName ? "firstName-error" : undefined}
                  />
                  {errors.firstName && (
                    <p id="firstName-error" className="text-xs text-destructive mt-0.5">
                      {errors.firstName.message}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lastName" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Familiya
                  </Label>
                  <Input
                    id="lastName"
                    placeholder="Familiyangiz"
                    className="h-12 rounded-xl border-border bg-muted/50 px-4 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0"
                    {...register("lastName")}
                    aria-invalid={!!errors.lastName}
                    aria-describedby={errors.lastName ? "lastName-error" : undefined}
                  />
                  {errors.lastName && (
                    <p id="lastName-error" className="text-xs text-destructive mt-0.5">
                      {errors.lastName.message}
                    </p>
                  )}
                </div>
              </div>

              {/* Step 2: Academic Info */}
              <div
                className={cn(
                  "flex flex-col gap-5 transition-all duration-300",
                  step === 1
                    ? "opacity-100 translate-y-0"
                    : "hidden opacity-0 translate-y-4"
                )}
              >
                <div className="flex items-center gap-2 text-muted-foreground">
                  <GraduationCap className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wider">
                    Akademik ma'lumotlar
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="university" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Universitet
                  </Label>
                  <Input
                    id="university"
                    placeholder="Universitet nomi"
                    className="h-12 rounded-xl border-border bg-muted/50 px-4 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0"
                    {...register("university")}
                    aria-invalid={!!errors.university}
                    aria-describedby={errors.university ? "university-error" : undefined}
                  />
                  {errors.university && (
                    <p id="university-error" className="text-xs text-destructive mt-0.5">
                      {errors.university.message}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="program" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Dastur
                  </Label>
                  <Select
                    value={programValue}
                    onValueChange={(value: "bachelors" | "masters" | "phd") =>
                      setValue("program", value, { shouldValidate: true })
                    }
                  >
                    <SelectTrigger
                      id="program"
                      className="h-12 rounded-xl border-border bg-muted/50 px-4 text-sm text-foreground focus:ring-1 focus:ring-primary focus:ring-offset-0 [&>span]:text-muted-foreground data-[state=open]:ring-1 data-[state=open]:ring-primary"
                      aria-invalid={!!errors.program}
                      aria-describedby={errors.program ? "program-error" : undefined}
                    >
                      <SelectValue placeholder="Dastur turini tanlang" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-border bg-card">
                      <SelectItem value="bachelors" className="rounded-lg text-foreground focus:bg-muted focus:text-foreground">
                        Bakalavr
                      </SelectItem>
                      <SelectItem value="masters" className="rounded-lg text-foreground focus:bg-muted focus:text-foreground">
                        Magistratura
                      </SelectItem>
                      <SelectItem value="phd" className="rounded-lg text-foreground focus:bg-muted focus:text-foreground">
                        PhD / Doktorantura
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.program && (
                    <p id="program-error" className="text-xs text-destructive mt-0.5">
                      {errors.program.message}
                    </p>
                  )}
                </div>
              </div>

              {/* Step 3: Document Upload */}
              <div
                className={cn(
                  "flex flex-col gap-5 transition-all duration-300",
                  step === 2
                    ? "opacity-100 translate-y-0"
                    : "hidden opacity-0 translate-y-4"
                )}
              >
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Upload className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wider">
                    Hujjat
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="document" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    ZIP faylni yuklang
                  </Label>
                  <div className="rounded-xl border border-dashed border-border bg-muted/40 p-4">
                    <input
                      id="document"
                      type="file"
                      accept=".zip,application/zip,application/x-zip-compressed"
                      {...documentRegister}
                      className="block w-full text-sm text-foreground file:mr-4 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary-foreground hover:file:bg-primary/90"
                      onChange={(e) => {
                        documentRegister.onChange(e)
                        const file = e.target.files?.[0]
                        setValue("document", (file || undefined) as File, { shouldValidate: true, shouldDirty: true })
                      }}
                      aria-invalid={!!errors.document}
                      aria-describedby={errors.document ? "document-error" : undefined}
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      Bitta .zip yuklang: Ariza, Universitet tasdiqlovchi hujjat, portfolio.
                    </p>
                    {existingSubmission?.docPath && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Hozirgi fayl: {existingSubmission.docPath}
                      </p>
                    )}
                    {documentValue && (
                      <p className="mt-2 text-xs text-foreground">
                        Tanlandi: {documentValue.name}
                      </p>
                    )}
                  </div>
                  {errors.document && (
                    <p id="document-error" className="text-xs text-destructive mt-0.5">
                      {errors.document.message as string}
                    </p>
                  )}
                </div>
              </div>

              {/* Navigation buttons */}
              <div className="flex items-center gap-3 pt-2">
                {step > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={prevStep}
                    className="h-12 flex-1 rounded-xl border-border bg-transparent text-sm font-medium text-foreground hover:bg-muted hover:text-foreground"
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Ortga
                  </Button>
                )}

                {step < 2 ? (
                  <Button
                    type="button"
                    onClick={nextStep}
                    className="h-12 flex-1 rounded-xl text-sm font-medium"
                  >
                    Davom etish
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={isSubmitting || (isTelegram && tgReady && !initData)}
                    className="h-12 flex-1 rounded-xl text-sm font-medium"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Yuborilmoqda...
                      </>
                    ) : (
                      <>
                        Yuborish
                        <Check className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                )}
              </div>

              {error && (
                <p className="text-xs text-destructive text-center" role="alert">
                  {error}
                </p>
              )}
            </form>
          </div>
        </div>

        {/* Footer */}
        <footer className="flex flex-col items-center gap-1.5 pb-4">
          <div className="flex items-center gap-1">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span className="text-xs text-muted-foreground">
              Tizim faol
            </span>
          </div>
        </footer>
      </div>
    </div>
  )
}
