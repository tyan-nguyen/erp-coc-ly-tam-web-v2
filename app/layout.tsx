import type { Metadata } from 'next'
import './globals.css'
import { ClearZeroNumberInputs } from '@/components/ui/clear-zero-number-inputs'

export const metadata: Metadata = {
  title: 'ERP Coc Ly Tam',
  description: 'ERP web app for Coc Ly Tam',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <ClearZeroNumberInputs />
        {children}
      </body>
    </html>
  )
}
