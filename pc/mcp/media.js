// Параметры готовых файлов для агента, который обрабатывает результаты скриптами: абсолютный путь, размер, ширина×высота
// картинок и видео, число полигонов и текстуры 3D-моделей. Без внешних библиотек — читаем заголовки файлов сами.
// Здесь же: GLB → OBJ (своими силами) и GLB → FBX (через Blender, если он установлен).
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

const MIME = {png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', obj: 'model/obj', mtl: 'text/plain', fbx: 'application/octet-stream', zip: 'application/zip'};
export const mimeOf = file => MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';

// ---- картинки: ширина и высота из заголовка (PNG, JPEG, WebP, GIF) ----
export function imageSize(buf) {
  if (!buf || buf.length < 30) return null;
  if (buf.readUInt32BE(0) === 0x89504e47) return {width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: 'png'};
  if (buf.toString('latin1', 0, 3) === 'GIF') return {width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), format: 'gif'};
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const c = buf.toString('latin1', 12, 16);
    if (c === 'VP8X') return {width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3), format: 'webp'};
    if (c === 'VP8 ') return {width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, format: 'webp'};
    if (c === 'VP8L') { const b = buf.readUInt32LE(21); return {width: (b & 0x3fff) + 1, height: ((b >>> 14) & 0x3fff) + 1, format: 'webp'}; }
    return null;
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let rotated = false;
    for (let i = 2; i + 9 < buf.length;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      // EXIF-поворот 5–8: на экране ширина и высота меняются местами
      if (m === 0xe1 && buf.toString('latin1', i + 4, i + 8) === 'Exif') rotated = exifRotated(buf.subarray(i + 10, i + 2 + len));
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) {
        const w = buf.readUInt16BE(i + 7), h = buf.readUInt16BE(i + 5);
        return rotated ? {width: h, height: w, format: 'jpeg'} : {width: w, height: h, format: 'jpeg'};
      }
      i += 2 + len;
    }
  }
  return null;
}
function exifRotated(t) {
  try {
    const le = t.toString('latin1', 0, 2) === 'II';
    const u16 = o => le ? t.readUInt16LE(o) : t.readUInt16BE(o), u32 = o => le ? t.readUInt32LE(o) : t.readUInt32BE(o);
    const ifd = u32(4);
    for (let k = 0, n = u16(ifd); k < n; k++) {
      const e = ifd + 2 + k * 12;
      if (u16(e) === 0x0112) return u16(e + 8) >= 5;
    }
  } catch {}
  return false;
}

// ---- видео MP4: ширина, высота (tkhd дорожки с картинкой) и длительность (mvhd) ----
export function videoInfo(buf) {
  if (!buf || buf.length < 64) return null;
  let width = 0, height = 0, duration = null;
  for (let t = buf.indexOf('tkhd'); t > 3; t = buf.indexOf('tkhd', t + 4)) {
    const v = buf[t + 4], size = buf.readUInt32BE(t - 4);
    if (!((v === 0 && size === 92) || (v === 1 && size === 104))) continue;   // случайные байты «tkhd» внутри данных
    const o = t + (v === 1 ? 92 : 80);
    const w = Math.round(buf.readUInt32BE(o) / 65536), h = Math.round(buf.readUInt32BE(o + 4) / 65536);
    if (w && h) { width = w; height = h; break; }
  }
  const m = buf.indexOf('mvhd');
  if (m > 3) {
    const v = buf[m + 4];
    const scale = buf.readUInt32BE(m + (v === 1 ? 24 : 16));
    const dur = v === 1 ? Number(buf.readBigUInt64BE(m + 28)) : buf.readUInt32BE(m + 20);
    if (scale) duration = Math.round(dur / scale * 100) / 100;
  }
  return width ? {width, height, duration} : (duration != null ? {width: null, height: null, duration} : null);
}

// ---- формат кадра ----
const gcd = (a, b) => b ? gcd(b, a % b) : a;
export const ratioOf = a => { const [w, h] = String(a).split(':').map(Number); return w / h; };
// «16:9» из 1376×768 не получится ровно: модели рисуют на своей сетке (Nano Banana 16:9 = 1376×768, 1,8 % от 16:9).
// Допуск 3,5 % — это округление модели; больше — картинка правда другого формата (её Freefield не обрезает, а помечает).
export function aspectCheck(width, height, want, tol = 0.035) {
  if (!width || !height) return {aspect_ratio_actual: null, aspect_ok: null};
  const g = gcd(width, height);
  const actual = `${width / g}:${height / g}`;
  if (!want) return {aspect_ratio_actual: actual, aspect_ok: null};
  const dev = Math.abs(Math.log((width / height) / ratioOf(want)));
  return {aspect_ratio_actual: actual, aspect_ok: dev <= tol, aspect_deviation: Math.round(dev * 1000) / 1000};
}

// ---- описание файла для агента ----
export function fileInfo(file, extra = {}) {
  const abs = path.resolve(file);
  const st = fs.statSync(abs, {throwIfNoEntry: false});
  const out = {path: abs, name: path.basename(abs), mime: mimeOf(abs), bytes: st?.size ?? null};
  try {
    if (/^image\//.test(out.mime)) {
      const fd = fs.openSync(abs, 'r');
      const head = Buffer.alloc(Math.min(st.size, 256 * 1024));
      fs.readSync(fd, head, 0, head.length, 0);
      fs.closeSync(fd);
      const s = imageSize(head);
      if (s) Object.assign(out, {width: s.width, height: s.height});
    } else if (/^video\//.test(out.mime)) {
      const v = videoInfo(fs.readFileSync(abs));
      if (v) Object.assign(out, v);
    }
  } catch {}
  return {...out, ...extra};
}

// ---- GLB: разбор, статистика, текстуры ----
export function parseGlb(buf) {
  if (!buf || buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) throw new Error('файл не GLB');
  let json = null, bin = null;
  for (let o = 12; o + 8 <= buf.length;) {
    const len = buf.readUInt32LE(o), type = buf.readUInt32LE(o + 4);
    if (type === 0x4e4f534a) json = JSON.parse(buf.toString('utf8', o + 8, o + 8 + len));
    else if (type === 0x004e4942) bin = buf.subarray(o + 8, o + 8 + len);
    o += 8 + len;
  }
  if (!json) throw new Error('в GLB нет описания сцены');
  return {json, bin};
}
const viewBytes = ({json, bin}, i) => {
  const v = json.bufferViews?.[i];
  return v && bin ? bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength) : null;
};
// узлы сцены с итоговыми матрицами (один меш может стоять в сцене несколько раз)
function sceneNodes(json) {
  const out = [];
  const mul = (a, b) => { const r = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return r; };
  const trs = n => {
    if (n.matrix) return n.matrix;
    const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
    return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
      2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
      2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
  };
  const walk = (i, parent, depth = 0) => {
    const n = json.nodes?.[i];
    if (!n || depth > 64) return;
    const m = mul(parent, trs(n));
    if (n.mesh != null) out.push({mesh: n.mesh, matrix: m});
    for (const c of n.children || []) walk(c, m, depth + 1);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const scene = json.scenes?.[json.scene ?? 0];
  if (scene) for (const r of scene.nodes || []) walk(r, I);
  else (json.meshes || []).forEach((_, mesh) => out.push({mesh, matrix: I}));
  return out;
}
export function glbStats(buf) {
  const g = parseGlb(buf), {json} = g;
  let triangles = 0, vertices = 0;
  for (const {mesh} of sceneNodes(json)) for (const p of json.meshes[mesh]?.primitives || []) {
    const pos = json.accessors?.[p.attributes?.POSITION];
    const n = p.indices != null ? json.accessors[p.indices]?.count || 0 : pos?.count || 0;
    const mode = p.mode ?? 4;
    vertices += pos?.count || 0;
    triangles += mode === 4 ? Math.floor(n / 3) : mode === 5 || mode === 6 ? Math.max(0, n - 2) : 0;
  }
  const textures = (json.images || []).map((im, i) => {
    const b = im.bufferView != null ? viewBytes(g, im.bufferView) : null;
    const s = b ? imageSize(b) : null;
    return {index: i, mime: im.mimeType || null, width: s?.width ?? null, height: s?.height ?? null};
  });
  const mats = json.materials || [];
  const pbr = mats.some(m => m.pbrMetallicRoughness?.metallicRoughnessTexture || m.normalTexture || m.occlusionTexture ||
    m.pbrMetallicRoughness?.metallicFactor != null || m.pbrMetallicRoughness?.roughnessFactor != null);
  const textured = mats.some(m => m.pbrMetallicRoughness?.baseColorTexture) || textures.length > 0;
  const compressed = (json.extensionsUsed || []).filter(e => /draco|meshopt/i.test(e));
  return {triangles, vertices, meshes: json.meshes?.length || 0, materials: mats.length, textures, textured, pbr, compressed};
}

// Достаёт данные аксессора как массив чисел (float/int, с нормализацией не возимся — нужны только позиции, нормали, UV, индексы)
function accessorData(g, i) {
  const a = g.json.accessors[i];
  const v = g.json.bufferViews[a.bufferView];
  const comps = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4}[a.type] || 1;
  const T = {5120: [Int8Array, 1, 'getInt8'], 5121: [Uint8Array, 1, 'getUint8'], 5122: [Int16Array, 2, 'getInt16'], 5123: [Uint16Array, 2, 'getUint16'],
    5125: [Uint32Array, 4, 'getUint32'], 5126: [Float32Array, 4, 'getFloat32']}[a.componentType];
  const out = new Float64Array(a.count * comps);
  const base = (v.byteOffset || 0) + (a.byteOffset || 0), stride = v.byteStride || T[1] * comps;
  const dv = new DataView(g.bin.buffer, g.bin.byteOffset, g.bin.byteLength);
  const norm = a.normalized ? {5120: 127, 5121: 255, 5122: 32767, 5123: 65535}[a.componentType] : 0;
  for (let k = 0; k < a.count; k++) for (let c = 0; c < comps; c++) {
    let x = dv[T[2]](base + k * stride + c * T[1], true);
    if (norm) x = Math.max(-1, x / norm);
    out[k * comps + c] = x;
  }
  return out;
}

// GLB → OBJ + MTL + текстуры (как лежат в GLB: PNG, JPEG или WebP — без пережатия). Возвращает пути файлов.
export function glbToObj(glbPath, outDir, base = 'model') {
  const g = parseGlb(fs.readFileSync(glbPath)), {json} = g;
  if ((json.extensionsUsed || []).some(e => /draco|meshopt/i.test(e))) throw new Error('модель сжата (Draco/Meshopt) — в OBJ её переводит только Blender');
  fs.mkdirSync(outDir, {recursive: true});
  const files = [];
  const texName = {};
  (json.images || []).forEach((im, i) => {
    const b = im.bufferView != null ? viewBytes(g, im.bufferView) : null;
    if (!b) return;
    const ext = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'}[im.mimeType] || (imageSize(b)?.format === 'jpeg' ? 'jpg' : imageSize(b)?.format) || 'png';
    const f = path.join(outDir, `${base}_texture_${i}.${ext}`);
    fs.writeFileSync(f, b);
    texName[i] = path.basename(f);
    files.push(f);
  });
  const texOf = ref => { const t = ref != null ? json.textures?.[ref.index] : null; const src = t?.source ?? t?.extensions?.EXT_texture_webp?.source; return src != null ? texName[src] : null; };
  const mtl = [];
  (json.materials || []).forEach((m, i) => {
    const pr = m.pbrMetallicRoughness || {};
    const c = pr.baseColorFactor || [1, 1, 1, 1];
    mtl.push(`newmtl material_${i}`, `Kd ${c.slice(0, 3).map(x => x.toFixed(4)).join(' ')}`, `d ${c[3].toFixed(4)}`,
      `Pm ${(pr.metallicFactor ?? 1).toFixed(4)}`, `Pr ${(pr.roughnessFactor ?? 1).toFixed(4)}`);
    const kd = texOf(pr.baseColorTexture), mr = texOf(pr.metallicRoughnessTexture), nm = texOf(m.normalTexture), em = texOf(m.emissiveTexture);
    if (kd) mtl.push(`map_Kd ${kd}`);
    if (mr) mtl.push(`# metallic (B) и roughness (G) в одной текстуре glTF`, `map_Pm ${mr}`, `map_Pr ${mr}`);
    if (nm) mtl.push(`norm ${nm}`, `map_Bump ${nm}`);
    if (em) mtl.push(`map_Ke ${em}`);
    mtl.push('');
  });
  const lines = [`# Freefield: из ${path.basename(glbPath)}`, `mtllib ${base}.mtl`];
  let vOff = 0, tOff = 0, nOff = 0;
  for (const [k, {mesh, matrix: M}] of sceneNodes(json).entries()) for (const [j, p] of (json.meshes[mesh]?.primitives || []).entries()) {
    if ((p.mode ?? 4) !== 4 || p.attributes?.POSITION == null) continue;
    const pos = accessorData(g, p.attributes.POSITION), nor = p.attributes.NORMAL != null ? accessorData(g, p.attributes.NORMAL) : null;
    const uv = p.attributes.TEXCOORD_0 != null ? accessorData(g, p.attributes.TEXCOORD_0) : null;
    const n = pos.length / 3;
    const idx = p.indices != null ? accessorData(g, p.indices) : Float64Array.from({length: n}, (_, i) => i);
    lines.push(`o mesh_${k}_${j}`);
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      lines.push(`v ${(M[0] * x + M[4] * y + M[8] * z + M[12]).toFixed(6)} ${(M[1] * x + M[5] * y + M[9] * z + M[13]).toFixed(6)} ${(M[2] * x + M[6] * y + M[10] * z + M[14]).toFixed(6)}`);
    }
    if (uv) for (let i = 0; i < n; i++) lines.push(`vt ${uv[i * 2].toFixed(6)} ${(1 - uv[i * 2 + 1]).toFixed(6)}`);
    if (nor) for (let i = 0; i < n; i++) {
      const x = nor[i * 3], y = nor[i * 3 + 1], z = nor[i * 3 + 2];
      const a = M[0] * x + M[4] * y + M[8] * z, b = M[1] * x + M[5] * y + M[9] * z, c = M[2] * x + M[6] * y + M[10] * z, l = Math.hypot(a, b, c) || 1;
      lines.push(`vn ${(a / l).toFixed(5)} ${(b / l).toFixed(5)} ${(c / l).toFixed(5)}`);
    }
    if (p.material != null) lines.push(`usemtl material_${p.material}`);
    const ref = i => `${vOff + i + 1}${uv || nor ? '/' + (uv ? tOff + i + 1 : '') : ''}${nor ? '/' + (nOff + i + 1) : ''}`;
    for (let i = 0; i + 2 < idx.length; i += 3) lines.push(`f ${ref(idx[i])} ${ref(idx[i + 1])} ${ref(idx[i + 2])}`);
    vOff += n; if (uv) tOff += n; if (nor) nOff += n;
  }
  const obj = path.join(outDir, base + '.obj'), mtlFile = path.join(outDir, base + '.mtl');
  fs.writeFileSync(obj, lines.join('\n') + '\n');
  fs.writeFileSync(mtlFile, mtl.join('\n'));
  return [obj, mtlFile, ...files];
}

// ---- Blender (бесплатный): GLB → FBX/OBJ с текстурами. Путь — из конфига Freefield, иначе ищем в обычных местах ----
export function findBlender(configured) {
  const cands = [configured, process.env.FREEFIELD_BLENDER].filter(Boolean);
  if (process.platform === 'win32') for (const root of ['C:/Program Files/Blender Foundation', 'C:/Program Files (x86)/Blender Foundation']) {
    try {
      const vers = fs.readdirSync(root).sort((a, b) => b.localeCompare(a, undefined, {numeric: true}));
      for (const v of vers) cands.push(path.join(root, v, 'blender.exe'));
    } catch {}
    cands.push(path.join(process.env.LOCALAPPDATA || '', 'Programs/Blender Foundation/Blender/blender.exe'));
  } else cands.push('/Applications/Blender.app/Contents/MacOS/Blender', '/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender');
  return cands.find(p => p && fs.existsSync(p)) || null;
}
const BLENDER_SCRIPT = `
import bpy, sys
src, dst, fmt = sys.argv[sys.argv.index('--') + 1:][:3]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
if fmt == 'fbx':
    bpy.ops.export_scene.fbx(filepath=dst, path_mode='COPY', embed_textures=True, add_leaf_bones=False)
else:
    try:
        bpy.ops.wm.obj_export(filepath=dst, path_mode='COPY', export_materials=True, export_pbr_extensions=True)
    except TypeError:
        bpy.ops.wm.obj_export(filepath=dst, path_mode='COPY', export_materials=True)
print('FREEFIELD_OK')
`;
export function blenderConvert(blender, src, dst, fmt, timeoutMs = 300000) {
  const script = path.join(path.dirname(dst), '.freefield-convert.py');
  fs.writeFileSync(script, BLENDER_SCRIPT);
  return new Promise((res, rej) => {
    const p = spawn(blender, ['-b', '--factory-startup', '-P', script, '--', src, dst, fmt], {windowsHide: true});
    let out = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    const t = setTimeout(() => { p.kill(); rej(new Error('Blender не успел перевести модель за 5 минут')); }, timeoutMs);
    p.on('error', e => { clearTimeout(t); rej(new Error('не удалось запустить Blender: ' + e.message)); });
    p.on('close', () => {
      clearTimeout(t);
      fs.rmSync(script, {force: true});
      if (/FREEFIELD_OK/.test(out) && fs.existsSync(dst)) res(dst);
      else rej(new Error('Blender не перевёл модель: ' + out.split('\n').filter(l => /Error|error/.test(l)).slice(-2).join(' ').slice(0, 300)));
    });
  });
}

// ---- zip (для приложения: модель + текстуры одним файлом) ----
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = buf => { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
// files: [{path, name}] → outFile (сжатие deflate)
export async function zipFiles(files, outFile) {
  const {deflateRawSync} = await import('node:zlib');
  const parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const data = fs.readFileSync(f.path), comp = deflateRawSync(data), name = Buffer.from(f.name.replace(/\\/g, '/'), 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(0, 12); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(off, 42);
    parts.push(local, name, comp);
    central.push(cen, name);
    off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  fs.writeFileSync(outFile, Buffer.concat([...parts, cd, end]));
  return outFile;
}
