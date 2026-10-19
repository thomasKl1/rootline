/**
 * Prépare une photo prise au téléphone : orientation corrigée, réduite à 1280 px
 * sur le plus grand côté et recompressée en JPEG. Une photo de 4 Mo passe ainsi
 * à environ 200 Ko, ce qui accélère l'envoi et l'identification.
 */
export async function prepareImage(file: Blob, maxSide = 1280): Promise<{ blob: Blob; base64: string }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Conversion impossible'))), 'image/jpeg', 0.85),
  )
  return { blob, base64: await toBase64(blob) }
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
