// Main menu. Lives apart from handler.ts so flow modules can fall back to it
// without creating an import cycle (menu.ts must not import any flow).

import { sendList } from './whatsapp';

export async function showMenu(to: string): Promise<void> {
  await sendList(
    to,
    '🐄 *FINCA* — ¿Qué vas a hacer?',
    'Abrir menú',
    [
      {
        title: '📋 Registros',
        rows: [
          { id: 'menu:animal', title: '🏷️ Registrar animal' },
          { id: 'menu:salud', title: '🩺 Salud / Tratam.' },
          { id: 'menu:reproduccion', title: '🍼 Reproducción' },
          { id: 'menu:pesaje', title: '⚖️ Pesaje' },
          { id: 'menu:mortalidad', title: '💀 Mortalidad' },
        ],
      },
      {
        title: '📊 Consultas',
        rows: [
          { id: 'menu:ver_animal', title: '🐄 Ver animal' },
          { id: 'menu:alertas', title: '⚠️ Alertas' },
          { id: 'menu:resumen', title: '📋 Resumen del día' },
        ],
      },
    ],
  );
}
