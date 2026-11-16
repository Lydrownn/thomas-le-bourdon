# Génère les modèles 3D de la grotte des compétences (6 piédestaux de pierre ancienne + temple marin).
# Usage : blender -b -P tools/make_skill_models.py -- assets/models
#
# Tout est construit en Python pur (pas de modèle téléchargé) : blocs taillés légèrement déformés,
# couleurs de sommets (mousse, humidité, pierre claire), puis export .glb.
# Repère de travail : x droite, y haut, z vers le spectateur (converti en repère Blender à l'export).
# Matériaux : Stone (couleurs de sommets), Rune (runes, émissif réglé côté Three.js),
# Glow (flammes, yeux), Portal (disque du portail).
import math
import os
import sys

import bpy
from mathutils import Vector

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '.'

STONE = (0.065, 0.088, 0.14)
STONE_DARK = (0.04, 0.055, 0.1)
BRONZE = (0.07, 0.28, 0.24)
MOSS = (0.03, 0.15, 0.09)
DAMP = (0.02, 0.05, 0.09)

M_STONE, M_RUNE, M_GLOW, M_PORTAL = 0, 1, 2, 3


def hsh(a, b, c, seed=0):
    v = math.sin(a * 127.1 + b * 311.7 + c * 74.7 + seed * 19.19) * 43758.5453
    return v - math.floor(v)


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def colour(p, n, kind, base, seed):
    if kind == 'rune':
        return (0.04, 0.06, 0.12, 1)
    if kind in ('glow', 'portal'):
        return (1, 1, 1, 1)
    if callable(base):
        return (*base(p, n), 1)
    b = base or {'stone': STONE, 'dark': STONE_DARK, 'bronze': BRONZE}[kind]
    h = hsh(round(p.x * 2.7, 2), round(p.y * 2.7, 2), round(p.z * 2.7, 2), seed)
    c = tuple(x * (0.78 + 0.44 * h) for x in b)
    h2 = hsh(p.x * 0.7, p.y * 0.7, p.z * 0.7, seed + 5)
    moss = clamp(n.y * 0.9 + 0.3 - p.y * 0.08 + (h2 - 0.5) * 0.9) ** 1.6
    c = mix(c, MOSS, moss * (0.3 if kind == 'bronze' else 0.7))
    damp = clamp(1 - p.y / 0.8)
    c = mix(c, DAMP, damp * 0.55)
    return (*c, 1)


class Builder:
    def __init__(self, seed=1):
        self.v, self.f, self.m, self.c = [], [], [], []
        self.seed = seed
        self.points = {}

    def add(self, verts, faces, mat, kind, base):
        cen = sum(verts, Vector()) / len(verts)
        i0 = len(self.v)
        self.v += verts
        for f in faces:
            pts = [verts[i] for i in f]
            n = Vector()
            for k in range(len(pts)):
                a, b = pts[k], pts[(k + 1) % len(pts)]
                n.x += (a.y - b.y) * (a.z + b.z)
                n.y += (a.z - b.z) * (a.x + b.x)
                n.z += (a.x - b.x) * (a.y + b.y)
            fc = sum(pts, Vector()) / len(pts)
            if n.dot(fc - cen) < 0:
                f = f[::-1]
                n = -n
            if n.length > 1e-9:
                n.normalize()
            self.f.append([i0 + i for i in f])
            self.m.append(mat)
            self.c.append(colour(fc, n, kind, base, self.seed))


def tf(p, c, yaw=0.0, tilt=(0.0, 0.0)):
    x, y, z = p
    rz, rx = tilt
    x, y = x * math.cos(rz) - y * math.sin(rz), x * math.sin(rz) + y * math.cos(rz)
    y, z = y * math.cos(rx) - z * math.sin(rx), y * math.sin(rx) + z * math.cos(rx)
    x, z = x * math.cos(yaw) + z * math.sin(yaw), -x * math.sin(yaw) + z * math.cos(yaw)
    return Vector((x + c[0], y + c[1], z + c[2]))


MAT_OF = {'rune': M_RUNE, 'glow': M_GLOW, 'portal': M_PORTAL}


def box(b, c, size, yaw=0.0, tilt=(0.0, 0.0), taper=1.0, jit=0.04, sub=2, kind='stone', base=None, seed=0, chamfer=0.06):
    key, verts, faces = {}, [], []

    def vid(u):
        k = tuple(round(x, 4) for x in u)
        if k not in key:
            key[k] = len(verts)
            ext = sum(1 for x in u if abs(abs(x) - 0.5) < 1e-6)
            q = [x * (1 - chamfer * max(0, ext - 1)) for x in u]
            tp = 1 + (taper - 1) * (u[1] + 0.5)
            loc = [q[0] * size[0] * tp, q[1] * size[1], q[2] * size[2] * tp]
            j = [(hsh(k[0], k[1], k[2], seed + i) - 0.5) * 2 * jit for i in range(3)]
            verts.append(tf([loc[i] + j[i] for i in range(3)], c, yaw, tilt))
        return key[k]

    n = sub
    for axis in range(3):
        for sg in (-0.5, 0.5):
            a1, a2 = [i for i in range(3) if i != axis]
            for i in range(n):
                for jx in range(n):
                    quad = []
                    for di, dj in ((0, 0), (1, 0), (1, 1), (0, 1)):
                        u = [0, 0, 0]
                        u[axis] = sg
                        u[a1] = -0.5 + (i + di) / n
                        u[a2] = -0.5 + (jx + dj) / n
                        quad.append(vid(u))
                    faces.append(quad)
    b.add(verts, faces, MAT_OF.get(kind, M_STONE), kind, base)


def prism(b, c, r0, r1, h, segs=8, rows=1, yaw=0.0, tilt=(0.0, 0.0), jit=0.03, kind='stone', base=None, seed=0, jag=0.0, flute=0.0):
    verts, faces = [], []
    for r in range(rows + 1):
        t = r / rows
        rad = r0 + (r1 - r0) * t
        for s in range(segs):
            ang = 2 * math.pi * s / segs
            rr = rad * (1 - flute * (s % 2))
            y = -h / 2 + h * t
            if r == rows and jag:
                y += (hsh(s, 3, seed, 7) - 0.7) * jag
            jx = (hsh(s, r, seed, 1) - 0.5) * 2 * jit
            jz = (hsh(s, r, seed, 2) - 0.5) * 2 * jit
            jy = (hsh(s, r, seed, 3) - 0.5) * 2 * jit
            verts.append(tf((rr * math.cos(ang) + jx, y + jy, rr * math.sin(ang) + jz), c, yaw, tilt))
    for r in range(rows):
        for s in range(segs):
            s2 = (s + 1) % segs
            faces.append([r * segs + s, r * segs + s2, (r + 1) * segs + s2, (r + 1) * segs + s])
    faces.append(list(range(segs)))
    faces.append(list(range(rows * segs, rows * segs + segs)))
    b.add(verts, faces, MAT_OF.get(kind, M_STONE), kind, base)


def boulder(b, c, r, sc=(1, 1, 1), segs=9, rings=5, jit=0.14, yaw=0.0, tilt=(0.0, 0.0), kind='stone', base=None, seed=0):
    verts, faces = [], []
    verts.append(tf((0, r * sc[1], 0), c, yaw, tilt))
    for ri in range(1, rings):
        phi = math.pi * ri / rings
        for s in range(segs):
            th = 2 * math.pi * s / segs
            rad = r * (1 + (hsh(s, ri, seed, 4) - 0.5) * 2 * jit)
            verts.append(tf((rad * math.sin(phi) * math.cos(th) * sc[0], rad * math.cos(phi) * sc[1], rad * math.sin(phi) * math.sin(th) * sc[2]), c, yaw, tilt))
    verts.append(tf((0, -r * sc[1], 0), c, yaw, tilt))
    last = len(verts) - 1
    for s in range(segs):
        s2 = (s + 1) % segs
        faces.append([0, 1 + s, 1 + s2])
        faces.append([last, 1 + (rings - 2) * segs + s2, 1 + (rings - 2) * segs + s])
    for ri in range(rings - 2):
        for s in range(segs):
            s2 = (s + 1) % segs
            faces.append([1 + ri * segs + s, 1 + (ri + 1) * segs + s, 1 + (ri + 1) * segs + s2, 1 + ri * segs + s2])
    b.add(verts, faces, MAT_OF.get(kind, M_STONE), kind, base)


def wedge(b, c, w, h, d, yaw=0.0, jit=0.05, kind='stone', base=None, seed=0):
    pts = [(-w / 2, 0, -d / 2), (w / 2, 0, -d / 2), (0, h, -d / 2), (-w / 2, 0, d / 2), (w / 2, 0, d / 2), (0, h, d / 2)]
    verts = []
    for i, p in enumerate(pts):
        j = [(hsh(i, seed, k, 9) - 0.5) * 2 * jit for k in range(3)]
        verts.append(tf((p[0] + j[0], p[1] - h / 3 + j[1], p[2] + j[2]), c, yaw))
    faces = [[0, 1, 2], [3, 4, 5], [0, 1, 4, 3], [0, 2, 5, 3], [1, 2, 5, 4]]
    b.add(verts, faces, MAT_OF.get(kind, M_STONE), kind, base)


def socket(b, x, top, z, seed=0):
    """Quatre petites pierres en couronne autour de la pierre à éclairer ; renvoie la position de celle-ci."""
    for i, (sx, sz) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        box(b, (x + sx * 0.5, top + 0.12, z + sz * 0.38), (0.26, 0.3, 0.26), yaw=0.3 * i, jit=0.025, seed=seed + i, kind='dark')
    return (x, top + 0.62, z)


def plaque(b, x, y, z, w, h, tilt=(0.0, 0.0), seed=0):
    """Plaque plate de face où le glyphe de la compétence est posé ; renvoie le point devant elle."""
    box(b, (x, y, z), (w, h, 0.14), tilt=tilt, jit=0.012, kind='dark', seed=seed, sub=1)
    return (x, y, z + 0.1)


# ─── Six piédestaux ──────────────────────────────────────────────────────────

def ped0(b):  # Monolithe
    box(b, (0, 0.2, 0), (3.0, 0.4, 2.3), jit=0.05, seed=1)
    box(b, (0.05, 0.58, 0.05), (2.4, 0.4, 1.8), yaw=0.08, jit=0.05, seed=2)
    box(b, (0, 2.05, 0), (1.5, 2.7, 1.2), taper=0.7, jit=0.035, sub=3, seed=3)
    box(b, (0, 3.46, 0), (1.15, 0.18, 0.92), jit=0.02, kind='dark', seed=4)
    for i, y in enumerate((1.0, 2.75)):
        box(b, (0, y, 0.5 - 0.05 * i), (1.3 - 0.25 * i, 0.07, 0.1), kind='rune', jit=0.0, sub=1)
    for sx in (-1, 1):
        box(b, (sx * 0.58, 1.85, 0.55), (0.07, 0.9, 0.06), kind='rune', jit=0.0, sub=1)
    tab = plaque(b, 0, 1.85, 0.54, 0.95, 0.95, seed=5)
    return socket(b, 0, 3.55, 0, 10), tab


def ped1(b):  # Deux blocs adossés, dalle posée dessus
    boulder(b, (-0.8, 1.35, 0), 1.2, (1, 1.45, 0.95), jit=0.12, seed=1)
    boulder(b, (0.85, 1.1, 0.1), 1.05, (1, 1.4, 0.9), jit=0.12, seed=2)
    boulder(b, (0.1, 0.35, 0.95), 0.55, (1.4, 0.65, 1), seed=3)
    boulder(b, (-1.2, 0.3, 1.0), 0.45, (1.2, 0.6, 1), seed=4)
    box(b, (0.05, 2.95, 0), (2.5, 0.34, 1.35), yaw=0.12, tilt=(0.05, 0.0), jit=0.03, sub=3, seed=5)
    box(b, (0.0, 2.95, 0.7), (1.6, 0.07, 0.06), tilt=(0.05, 0), kind='rune', jit=0.0, sub=1)
    tab = plaque(b, 0, 1.1, 1.05, 1.1, 1.3, tilt=(0.0, -0.12), seed=6)
    return socket(b, 0.05, 3.12, 0, 20), tab


def ped2(b):  # Ziggourat
    y = 0
    for i, (w, h, d) in enumerate(((3.0, 0.45, 2.4), (2.5, 0.45, 1.95), (2.0, 0.5, 1.55), (1.55, 0.55, 1.2))):
        box(b, (0, y + h / 2, 0), (w, h, d), yaw=0.04 * i, jit=0.04, sub=3, seed=1 + i)
        y += h
    box(b, (0, y + 0.65, 0), (1.3, 1.3, 0.95), taper=0.88, jit=0.03, sub=3, seed=6)
    top = y + 1.3
    box(b, (0, top + 0.08, 0), (1.25, 0.16, 1.0), kind='dark', jit=0.02, seed=7)
    for i, z in enumerate((1.5, 1.85)):
        box(b, (0, 0.1 + 0.1 * i, z - 0.2 * i), (1.3 - 0.3 * i, 0.2 + 0.1 * i, 0.55), jit=0.03, seed=8 + i)
    box(b, (0, y + 1.25, 0.5), (1.1, 0.06, 0.06), kind='rune', jit=0.0, sub=1)
    tab = plaque(b, 0, y + 0.6, 0.5, 0.95, 0.8, seed=9)
    return socket(b, 0, top + 0.16, 0, 30), tab


def ped3(b):  # Porte : deux piliers, linteau, pierre entre eux
    box(b, (0, 0.2, 0), (3.2, 0.4, 2.1), jit=0.05, seed=1)
    for i, sx in enumerate((-1, 1)):
        box(b, (sx * 1.1, 1.95, 0), (0.62, 3.1, 0.62), taper=0.86, jit=0.025, sub=3, seed=2 + i, yaw=0.05 * sx)
        box(b, (sx * 1.1, 0.55, 0), (0.85, 0.3, 0.85), kind='dark', jit=0.02, seed=4 + i)
        box(b, (sx * 1.1, 1.2, 0.34), (0.07, 1.5, 0.05), kind='rune', jit=0.0, sub=1)
    box(b, (0, 3.62, 0), (3.2, 0.5, 0.8), jit=0.035, sub=3, seed=6, yaw=0.02)
    box(b, (0.35, 3.95, 0), (1.4, 0.35, 0.65), yaw=-0.1, jit=0.03, seed=7)
    box(b, (0, 3.6, 0.42), (2.2, 0.07, 0.05), kind='rune', jit=0.0, sub=1)
    box(b, (0, 1.0, 0), (1.0, 1.2, 0.85), taper=0.92, jit=0.03, sub=3, seed=8)
    box(b, (0, 1.68, 0), (1.2, 0.14, 1.0), kind='dark', jit=0.02, seed=9)
    tab = plaque(b, 0, 0.95, 0.45, 0.8, 0.8, seed=10)
    return socket(b, 0, 1.75, 0, 40), tab


def ped4(b):  # Couronne : vasque et lances de pierre
    prism(b, (0, 0.25, 0), 1.35, 1.2, 0.5, segs=9, jit=0.05, seed=1)
    prism(b, (0, 1.1, 0), 1.0, 0.85, 1.2, segs=9, rows=2, jit=0.04, seed=2, flute=0.05)
    prism(b, (0, 1.78, 0), 1.0, 1.05, 0.16, segs=9, kind='dark', jit=0.02, seed=3)
    for k in range(6):
        ang = k * math.pi / 3 + 0.25
        R = 1.2
        prism(b, (R * math.cos(ang), 1.9, -R * math.sin(ang)), 0.3, 0.03, 2.5, segs=5, yaw=ang,
              tilt=(-0.2 - 0.05 * (k % 2), 0.0), jit=0.03, seed=10 + k, rows=2)
    prism(b, (0, 1.2, 0.0), 1.02, 1.0, 0.07, segs=9, kind='rune', jit=0.0)
    tab = plaque(b, 0, 1.1, 0.96, 0.9, 0.75, seed=4)
    return (0, 2.4, 0), tab


def ped5(b):  # Colonne brisée
    box(b, (0, 0.2, 0), (2.7, 0.4, 2.2), jit=0.05, seed=1)
    box(b, (0, 0.58, 0), (2.1, 0.36, 1.75), yaw=-0.06, jit=0.04, seed=2)
    prism(b, (0, 1.9, 0), 0.78, 0.62, 2.3, segs=10, rows=2, jit=0.02, seed=3, jag=0.2, flute=0.07)
    prism(b, (0, 0.95, 0), 0.9, 0.78, 0.3, segs=10, kind='dark', jit=0.02, seed=4)
    box(b, (1.2, 0.75, 0.75), (1.4, 0.5, 1.3), yaw=0.5, tilt=(0.2, 0.15), jit=0.04, seed=5)
    box(b, (0, 3.12, 0), (1.35, 0.16, 1.35), yaw=0.2, kind='dark', jit=0.02, seed=6)
    prism(b, (0, 1.9, 0), 0.8, 0.8, 0.07, segs=10, kind='rune', jit=0.0)
    tab = plaque(b, 0, 0.9, 1.1, 1.0, 1.05, tilt=(0.0, -0.1), seed=7)
    return socket(b, 0, 3.2, 0, 50), tab


PEDESTALS = [ped0, ped1, ped2, ped3, ped4, ped5]


# ─── Temple ──────────────────────────────────────────────────────────────────

def temple(b):
    rnd = lambda i, lo, hi, s=0: lo + (hi - lo) * hsh(i, s, 5, 11)  # noqa: E731
    # plateformes
    box(b, (0, 0.3, -8), (42, 0.6, 17), jit=0.08, sub=8, seed=1)
    box(b, (0, 0.9, -9.5), (36, 0.6, 14), jit=0.08, sub=8, seed=2)
    box(b, (0, 1.5, -11), (30, 0.6, 11), jit=0.08, sub=8, seed=3)
    for i in range(3):
        box(b, (0, 0.14 + 0.0, 1.0 + 0.0 - 0.2 * i), (11 - 1.5 * i, 0.28 + 0.0, 1.6), jit=0.04, sub=4, seed=4 + i, yaw=0.0)
    # colonnes
    xs = [-13, -8.67, -4.33, 0, 4.33, 8.67, 13]
    heights = [2.4, 6.2, 6.2, 6.2, 6.2, 3.8, 1.1]
    for i, (x, H) in enumerate(zip(xs, heights)):
        z = -6.5
        box(b, (x, 1.8 + 0.18, z), (2.1, 0.36, 2.1), jit=0.04, sub=3, seed=10 + i)
        prism(b, (x, 1.8 + 0.36 + H / 2, z), 0.8, 0.64, H, segs=12, rows=3, jit=0.025, seed=20 + i, flute=0.05,
              jag=0.5 if H < 6 else 0.0)
        if H > 6:
            prism(b, (x, 1.8 + 0.36 + H + 0.2, z), 0.7, 1.05, 0.4, segs=12, kind='bronze', jit=0.02, seed=30 + i)
            box(b, (x, 1.8 + 0.36 + H + 0.55, z), (2.3, 0.3, 2.3), jit=0.03, sub=3, seed=40 + i)
            for k in range(3):
                box(b, (x, 1.8 + 1.6 + k * 1.8, z + 0.0), (1.9, 0.06, 1.9), kind='bronze', jit=0.0, sub=1) if False else None
    top = 1.8 + 0.36 + 6.2 + 0.7
    # entablement + fronton (côté droit brisé)
    box(b, (-2.2, top + 0.45, -6.5), (15.6, 0.9, 2.5), jit=0.04, sub=8, seed=50)
    box(b, (-2.2, top + 0.45, -5.22), (14.0, 0.2, 0.06), kind='rune', jit=0.0, sub=1)
    wedge(b, (-2.2, top + 0.9, -6.5), 15.6, 2.4, 2.4, jit=0.06, seed=51)
    # mur du fond avec ouverture centrale
    box(b, (-9.2, 6.0, -13.4), (13.0, 8.4, 1.8), jit=0.06, sub=8, seed=60)
    box(b, (-9.2, 10.9, -13.4), (7.0, 1.6, 1.6), tilt=(0.0, 0.0), yaw=0.04, jit=0.12, sub=3, seed=61)
    box(b, (9.2, 5.0, -13.4), (13.0, 6.4, 1.8), jit=0.06, sub=8, seed=62)
    box(b, (11.8, 8.6, -13.4), (4.4, 1.2, 1.5), yaw=-0.1, tilt=(0.1, 0.0), jit=0.12, sub=3, seed=63)
    box(b, (0, 10.0, -13.4), (6.4, 1.2, 1.8), jit=0.05, sub=4, seed=64)
    box(b, (0, 6.0, -14.7), (6.0, 8.0, 0.4), kind='dark', jit=0.01, sub=1, seed=65)
    # portail : disque + anneau d'éléments lumineux
    prism(b, (0, 6.0, -14.3), 2.5, 2.5, 0.06, segs=24, tilt=(0.0, math.pi / 2), kind='portal', jit=0.0)
    n = 22
    for k in range(n):
        a = 2 * math.pi * k / n
        box(b, (2.85 * math.cos(a), 6.0 + 2.85 * math.sin(a), -13.7), (0.62, 0.28, 0.3), tilt=(a + math.pi / 2, 0.0),
            kind='glow' if k % 2 == 0 else 'rune', jit=0.0, sub=1, chamfer=0.1)
    # gardiens de part et d'autre
    for sgn in (-1, 1):
        x = 6.3 * sgn
        z = -9.8
        box(b, (x, 1.8 + 0.7, z), (2.4, 1.4, 2.4), jit=0.05, sub=4, seed=70 + sgn)
        box(b, (x, 1.8 + 1.4 + 1.5, z), (1.7, 3.0, 1.2), taper=0.82, jit=0.04, sub=4, seed=72 + sgn)
        box(b, (x, 1.8 + 1.4 + 3.1, z), (2.9, 0.65, 1.4), jit=0.04, sub=3, seed=74 + sgn, kind='bronze')
        box(b, (x, 1.8 + 1.4 + 3.95, z), (1.15, 1.2, 1.05), jit=0.04, sub=3, seed=76 + sgn, yaw=0.08 * sgn)
        for e in (-1, 1):
            box(b, (x + e * 0.28, 1.8 + 1.4 + 4.0, z + 0.53), (0.3, 0.1, 0.06), kind='glow', jit=0.0, sub=1)
        for k in range(3):
            prism(b, (x + (k - 1) * 0.42, 1.8 + 1.4 + 4.95, z), 0.2, 0.02, 0.8, segs=4, seed=80 + k, jit=0.01)
        for e in (-1, 1):
            box(b, (x + e * 1.5, 1.8 + 1.4 + 2.2, z), (0.5, 2.0, 0.6), tilt=(0.0, 0.0), jit=0.03, sub=2, seed=84 + e)
    # braziers
    for sgn in (-1, 1):
        x = 3.8 * sgn
        z = 1.8
        prism(b, (x, 0.9, z), 0.28, 0.2, 1.2, segs=8, kind='bronze', jit=0.02, seed=90)
        prism(b, (x, 1.7, z), 0.7, 0.45, 0.5, segs=8, kind='bronze', jit=0.02, seed=91)
        boulder(b, (x, 2.15, z), 0.34, (0.8, 1.4, 0.8), segs=6, rings=4, kind='glow', jit=0.05)
    # gravats et tambours de colonne
    for i in range(34):
        x = rnd(i, -20, 20, 1)
        z = rnd(i, 1.2, 5.5, 2)
        s = rnd(i, 0.35, 1.0, 3)
        box(b, (x, s * 0.35, z), (s * 1.3, s * 0.7, s), yaw=rnd(i, 0, 3, 4), tilt=(rnd(i, -0.2, 0.2, 5), rnd(i, -0.2, 0.2, 6)),
            jit=0.05, seed=100 + i)
    for i, x in enumerate((-17, -10.5, 14.5, 20)):
        prism(b, (x, 0.75, 3.0 + 1.3 * (i % 2)), 0.78, 0.7, 1.2, segs=12, tilt=(0.0, math.pi / 2), yaw=0.6 * i, jit=0.03, seed=120 + i, flute=0.05)
    # petits blocs sur les marches
    for i in range(12):
        x = rnd(i, -16, 16, 7)
        z = rnd(i, -11, -3, 8)
        s = rnd(i, 0.3, 0.8, 9)
        box(b, (x, 1.8 + s * 0.35, z), (s * 1.2, s * 0.7, s), yaw=rnd(i, 0, 3, 10), jit=0.04, seed=140 + i)


# ─── Export ──────────────────────────────────────────────────────────────────

def make_material(name, base=(1, 1, 1, 1), emit=None, vcol=False, rough=0.92):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = base
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = 0.0
    if vcol:
        vc = m.node_tree.nodes.new('ShaderNodeVertexColor')
        vc.layer_name = 'Col'
        m.node_tree.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    if emit:
        bsdf.inputs['Emission Color'].default_value = emit
        bsdf.inputs['Emission Strength'].default_value = 1.0
    return m


def export(name, b, empties):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    me = bpy.data.meshes.new(name)
    to_b = lambda v: (v.x, -v.z, v.y)  # noqa: E731  (y haut -> z haut de Blender)
    me.from_pydata([to_b(v) for v in b.v], [], b.f)
    me.update()
    for mat in (
        make_material('Stone', vcol=True),
        make_material('Rune', (0.05, 0.08, 0.14, 1), (0.3, 0.8, 1, 1), rough=0.5),
        make_material('Glow', (0.3, 0.9, 1, 1), (0.3, 0.9, 1, 1), rough=0.4),
        make_material('Portal', (0.2, 0.7, 1, 1), (0.2, 0.7, 1, 1), rough=0.4),
    ):
        me.materials.append(mat)
    for poly, m in zip(me.polygons, b.m):
        poly.material_index = m
        poly.use_smooth = False
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    for poly, col in zip(me.polygons, b.c):
        for li in poly.loop_indices:
            ca.data[li].color = col
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for en, p in empties.items():
        e = bpy.data.objects.new(en, None)
        e.location = to_b(Vector(p))
        e.empty_display_size = 0.2
        bpy.context.scene.collection.objects.link(e)
    bpy.ops.object.select_all(action='SELECT')
    path = os.path.join(OUT, f'{name}.glb')
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True)
    try:
        bpy.ops.export_scene.gltf(export_vertex_color='ACTIVE', **kw)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)
    print('OK', path, len(b.f), 'faces', os.path.getsize(path) // 1024, 'Ko')


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for i, fn in enumerate(PEDESTALS):
        b = Builder(seed=i * 7 + 1)
        gem, tab = fn(b)
        export(f'skill_rock_{i}', b, {'Gem': gem, 'Tablet': tab})
    b = Builder(seed=99)
    temple(b)
    export('temple', b, {})
