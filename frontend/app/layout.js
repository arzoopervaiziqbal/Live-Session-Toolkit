import "./globals.css";
import { ThemeProvider } from "../contexts/ThemeContext";

export const metadata = {
  title: "LiveHub — AI Live Session Toolkit",
  description: "AI-generated quizzes, live polls, and Q&A for live sessions",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="text-[#14162B] dark:text-[#E7E8F5] min-h-screen">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
