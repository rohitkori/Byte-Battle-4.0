import "./globals.css";

export const metadata = {
  title: "QueryGPT",
  description: "A React and Next.js QueryGPT frontend.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
