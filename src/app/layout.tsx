export const metadata = {
  title: 'Finca Bot',
  description: 'WhatsApp bot + API para gestión ganadera',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
