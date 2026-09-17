import "./globals.css";

export const metadata = {
  title: "Full Stock — Attendance & Deductions",
  description: "Reconcile daily attendance and apply deductions straight to ZenHR.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
