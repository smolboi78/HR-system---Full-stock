export const metadata = {
  title: "HR Attendance Dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f5f6f8", color: "#111" }}>{children}</body>
    </html>
  );
}
