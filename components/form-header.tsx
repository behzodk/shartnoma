import { FileText } from "lucide-react"

export function FormHeader() {
  return (
    <header className="flex flex-col items-center gap-3 pb-2">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
        <FileText className="h-6 w-6 text-primary" />
      </div>
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          EYUF hujjat topshirish
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Shartnomani yuklash
        </p>
      </div>
    </header>
  )
}
