import "./globals.css";
import { ThemeProvider } from "../contexts/ThemeContext";
import { LangProvider } from "../contexts/LangContext";

export const metadata = {
  title: "LiveHub — AI Live Session Toolkit",
  description: "AI-generated quizzes, polls, feedback, and Q&A for live sessions",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="text-[#14162B] dark:text-[#E7E8F5] min-h-screen">
        <ThemeProvider>
          <LangProvider>{children}</LangProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
