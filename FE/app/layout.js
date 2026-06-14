import "./globals.css";

export const metadata = {
  title: "Chat Bot",
  description: "A React and Next.js chatbot frontend.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
