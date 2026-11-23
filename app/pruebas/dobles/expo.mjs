// Dobles de los modulos nativos de Expo. Las pruebas no abren la
// camara ni tocan el disco: lo que se quiere ejercitar son las reglas
// y la cola, no el hardware.
//
// La memoria de archivos es un simple mapa de uri a bytes, suficiente
// para que exists, bytes() y delete() se comporten como deben.

const archivos = new Map()

export const _archivos = archivos

export class File {
  constructor(...partes) {
    this.uri = partes.map(p => (typeof p === 'string' ? p : p.uri)).join('/')
  }
  get exists() { return archivos.has(this.uri) }
  get name() { return this.uri.split('/').pop() }
  info() { return { exists: this.exists, uri: this.uri, size: archivos.get(this.uri)?.length ?? 0 } }
  async bytes() { return archivos.get(this.uri) ?? new Uint8Array(0) }
  async move(destino) {
    const d = typeof destino === 'string' ? destino : destino.uri
    archivos.set(d, archivos.get(this.uri) ?? new Uint8Array([1, 2, 3]))
    archivos.delete(this.uri)
    this.uri = d
  }
  delete() { archivos.delete(this.uri) }
}

export class Directory {
  constructor(...partes) {
    this.uri = partes.map(p => (typeof p === 'string' ? p : p.uri)).join('/')
    this.exists = true
  }
  create() { this.exists = true }
}

export const Paths = { document: { uri: 'mem://doc' }, cache: { uri: 'mem://cache' } }

// --- camara ---
export let _siguienteFoto = { canceled: true, assets: null }
export function _ponerFoto(f) { _siguienteFoto = f }

export async function getCameraPermissionsAsync() { return { granted: true, canAskAgain: true } }
export async function requestCameraPermissionsAsync() { return { granted: true, canAskAgain: true } }
export async function launchCameraAsync() { return _siguienteFoto }

// --- reductor ---
export const SaveFormat = { JPEG: 'jpeg', PNG: 'png' }
export const ImageManipulator = {
  manipulate(uri) {
    const ctx = {
      resize() { return ctx },
      async renderAsync() {
        return {
          async saveAsync() {
            const destino = uri + '.reducida'
            archivos.set(destino, new Uint8Array([1, 2, 3, 4]))
            return { uri: destino, width: 1280, height: 960 }
          },
        }
      },
    }
    return ctx
  },
}
