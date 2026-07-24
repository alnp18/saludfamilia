# Configuración de Iconos PWA

## Estado actual

✅ Archivos creados:
- `/public/icon.svg` — Logo en SVG (escalable, funciona en navegadores modernos)
- `/public/manifest.json` — Configuración PWA
- `/public/sw.js` — Service Worker
- `vite.config.js` — Con VitePWA plugin
- `index.html` — Con metadatos PWA
- `vercel.json` — Con cache headers

❌ Falta (opcional pero recomendado):
- `icon-192.png` — Para Android (192×192)
- `icon-512.png` — Para Android/Web (512×512)
- `icon-180.png` — Para iOS (180×180)
- `icon-512-maskable.png` — Para Android adaptive icon (512×512)

## Cómo generar los PNGs

### Opción 1: Online (más simple, sin instalar nada)

1. Ve a **https://realfavicongenerator.net/**
2. Sube `/public/icon.svg`
3. Deja opciones por defecto (versión PWA)
4. Descarga el ZIP resultante
5. Extrae los PNGs a `/public/`:
   - `icon-192.png`
   - `icon-512.png`
   - `icon-180.png`
   - `icon-512-maskable.png` (si lo genera)

**Nota**: si realfavicongenerator no genera la versión maskable, simplemente copia `icon-512.png` → `icon-512-maskable.png`.

### Opción 2: Desde la terminal (si tienes ImageMagick instalado)

```bash
# Instala ImageMagick si no lo tienes
# Windows (con Chocolatey):
choco install imagemagick

# macOS:
brew install imagemagick

# Luego, desde la raíz del proyecto:
convert public/icon.svg -resize 192x192 public/icon-192.png
convert public/icon.svg -resize 512x512 public/icon-512.png
convert public/icon.svg -resize 180x180 public/icon-180.png
convert public/icon.svg -resize 512x512 public/icon-512-maskable.png
```

### Opción 3: Desde Node.js (si prefieres un script)

Instala:
```bash
npm install -D sharp
```

Crea un archivo `generate-icons.js` en la raíz:

```javascript
const sharp = require('sharp');
const fs = require('fs');

const sizes = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-180.png', size: 180 },
  { name: 'icon-512-maskable.png', size: 512 }
];

sizes.forEach(({ name, size }) => {
  sharp('public/icon.svg')
    .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(`public/${name}`, (err) => {
      if (err) {
        console.error(`Error generating ${name}:`, err);
      } else {
        console.log(`✓ ${name}`);
      }
    });
});
```

Luego:
```bash
node generate-icons.js
```

## Verificación

Después de agregar los PNGs (o solo con el SVG), prueba:

```bash
npm run build
npm run preview
```

Abre en tu navegador:
- **Chrome/Edge**: Abre DevTools → Application → Manifest — debe mostrar sin errores
- **Chrome**: Click en ⋯ → "Instalar SaludFamilia"
- **Firefox**: Abre DevTools → Storage → Cache Storage — debe haber un caché con versión de vite-plugin-pwa

## Qué hace cada archivo

| Archivo | Propósito |
|---------|-----------|
| `icon.svg` | Fuente escalable (funciona en todos lados) |
| `icon-192.png` | Icono de app en Android/Home screen |
| `icon-512.png` | Icono grande para splash screen |
| `icon-180.png` | Icono para iOS (Apple touch icon) |
| `icon-512-maskable.png` | Icono adaptativo Android (recortable) |
| `manifest.json` | Especificación PWA (color, nombre, shortcuts, etc.) |
| `sw.js` | Service Worker (caché + offline) |

## Próximos pasos

1. Genera los PNGs con una de las 3 opciones arriba
2. Haz commit: `git add public/icon-*.png && git commit -m "feat: agregar iconos PWA"`
3. Push a Vercel: `git push origin main`
4. Verifica en https://saludfamilia.vercel.app desde un Android o iPhone

## Testing en desarrollo

```bash
npm run dev
```

Abre `http://localhost:5173` en Chrome → DevTools → Application → Manifest. Si ves verde, está listo.

Para simular PWA en desktop:
- Chrome: DevTools → More tools → Web App Manifests → "Install"
- Edge: Click en el ícono de "Instalar app" en la barra de direcciones
