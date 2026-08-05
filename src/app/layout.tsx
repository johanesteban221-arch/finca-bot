import './globals.css';

export const metadata = {
  title: 'Finca — Gestión ganadera',
  description: 'WhatsApp bot + tablero para gestión de ganadería doble propósito',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1a3821',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
