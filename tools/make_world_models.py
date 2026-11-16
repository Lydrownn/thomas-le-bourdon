# Génère les modèles « du monde » du portfolio : méduse lumineuse, poissons, roches stratifiées.
# Usage : blender -b -P tools/make_world_models.py -- assets/models
# Réutilise les primitives de make_skill_models.py (même dossier).
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_skill_models as K  # noqa: E402
from make_skill_models import Builder, boulder, hsh, mix, clamp  # noqa: E402

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '.'
V = lambda *a: Vector(a[0] if len(a) == 1 else a)


def surf(b, nu, nv, fn, wrap=True, mat=0, kind='stone', base=None):
    """Surface paramétrique : fn(u, v) -> Vector, u en lignes, v autour (wrap) ou en colonnes."""
    verts, faces = [], []
    cols = nv if wrap else nv + 1
    for i in range(nu + 1):
        for j in range(cols):
            verts.append(fn(i / nu, j / nv))
    for i in range(nu):
        for j in range(nv):
            j2 = (j + 1) % cols if wrap else j + 1
            faces.append([i * cols + j, i * cols + j2, (i + 1) * cols + j2, (i + 1) * cols + j])
    b.add(verts, faces, mat, kind, base)


def poly(b, pts, mat=0, kind='stone', base=None):
    b.add([V(p) for p in pts], [list(range(len(pts)))], mat, kind, base)


def export_parts(name, parts, materials, empties=None):
    """parts : liste de (nom, Builder, position, parent_nom|None). Un objet glTF par partie."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    to_b = lambda v: (v[0], -v[2], v[1])  # noqa: E731
    mats = [mk(*m) for m in materials]
    objs = {}
    for pname, b, loc, parent in parts:
        me = bpy.data.meshes.new(pname)
        me.from_pydata([to_b(v) for v in b.v], [], b.f)
        me.update()
        for m in mats:
            me.materials.append(m)
        for poly_, mi in zip(me.polygons, b.m):
            poly_.material_index = mi
            poly_.use_smooth = False
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        for poly_, col in zip(me.polygons, b.c):
            for li in poly_.loop_indices:
                ca.data[li].color = col
        o = bpy.data.objects.new(pname, me)
        o.location = to_b(loc)
        bpy.context.scene.collection.objects.link(o)
        objs[pname] = (o, parent)
    for pname, (o, parent) in objs.items():
        if parent:
            o.parent = objs[parent][0]
    for en, p in (empties or {}).items():
        e = bpy.data.objects.new(en, None)
        e.location = to_b(V(p))
        bpy.context.scene.collection.objects.link(e)
    bpy.ops.object.select_all(action='SELECT')
    path = os.path.join(OUT, f'{name}.glb')
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True)
    try:
        bpy.ops.export_scene.gltf(export_vertex_color='ACTIVE', **kw)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)
    nf = sum(len(b.f) for _, b, _, _ in parts)
    print('OK', path, nf, 'faces', os.path.getsize(path) // 1024, 'Ko')


def mk(name, base=(1, 1, 1, 1), emit=None, vcol=True, rough=0.8):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = base
    bsdf.inputs['Roughness'].default_value = rough
    if vcol:
        vc = m.node_tree.nodes.new('ShaderNodeVertexColor')
        vc.layer_name = 'Col'
        m.node_tree.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    if emit:
        bsdf.inputs['Emission Color'].default_value = emit
        bsdf.inputs['Emission Strength'].default_value = 1.0
    return m


# ─── Méduse lumineuse ────────────────────────────────────────────────────────
def jelly():
    bell, arms, core = Builder(3), Builder(4), Builder(5)
    lobes = 8

    def outer(u, v):
        th = 2 * math.pi * v
        ph = u * math.pi / 2  # 0 sommet -> pi/2 bord
        r = math.sin(ph) * (1 + 0.05 * math.cos(lobes * th) * u)
        y = 0.95 * math.cos(ph) ** 0.9
        # bord évasé et festonné
        if u > 0.82:
            k = (u - 0.82) / 0.18
            r += 0.12 * k
            y -= 0.1 * k * (0.5 + 0.5 * math.cos(lobes * th))
        return V((r * math.cos(th), y, r * math.sin(th)))

    def inner(u, v):
        p = outer(u, v)
        return V((p.x * 0.88, p.y * 0.86 - 0.03, p.z * 0.88))

    col = lambda p, n: mix((0.55, 0.62, 0.7), (1, 1, 1), clamp(p.y * 1.1))  # noqa: E731
    surf(bell, 9, 32, outer, mat=0, kind='stone', base=col)
    surf(bell, 9, 32, inner, mat=0, kind='stone', base=col)
    # nervures
    for k in range(lobes):
        th = 2 * math.pi * (k + 0.5) / lobes
        def rib(u, v, th=th):
            p = outer(u * 0.95, th / (2 * math.pi))
            return V((p.x * 1.02 + (v - 0.5) * 0.03 * math.sin(th), p.y + 0.01, p.z * 1.02 - (v - 0.5) * 0.03 * math.cos(th)))
        surf(bell, 7, 1, rib, wrap=False, mat=1, kind='stone', base=lambda p, n: (1, 1, 1))
    # noyau : quatre gonades en trèfle + centre
    for k in range(4):
        a = k * math.pi / 2 + 0.4
        boulder(core, (0.28 * math.cos(a), 0.42, 0.28 * math.sin(a)), 0.17, (1, 0.7, 1), segs=7, rings=4, jit=0.05, kind='glow')
    boulder(core, (0, 0.58, 0), 0.2, (1, 0.9, 1), segs=7, rings=4, jit=0.04, kind='glow')
    # bras buccaux : rubans froncés
    for k in range(4):
        a0 = k * math.pi / 2 + 0.2

        def frill(u, v, a0=a0):
            y = -0.05 - 1.9 * u
            w = 0.16 * (1 - u * 0.7)
            sway = math.sin(u * 9 + a0 * 2) * 0.09 * u
            r = 0.2 + 0.1 * math.sin(u * 5 + a0)
            ang = a0 + sway * 4
            base = V((r * math.cos(ang), y, r * math.sin(ang)))
            tang = V((-math.sin(ang), 0, math.cos(ang)))
            return base + tang * (v - 0.5) * 2 * w + V((0, 0, 0))
        surf(arms, 14, 3, frill, wrap=False, mat=1, kind='stone', base=lambda p, n: (1, 1, 1))
    # tentacules fins du bord
    nt = 20
    for k in range(nt):
        a = 2 * math.pi * k / nt + 0.1 * hsh(k, 1, 1)
        ln = 2.8 + 1.2 * hsh(k, 2, 3)

        def ten(u, v, a=a, ln=ln, k=k):
            y = -0.02 - ln * u
            r = 1.02 - 0.18 * u + 0.12 * math.sin(u * 7 + k)
            ang = a + 0.35 * math.sin(u * 5 + k * 1.7) * u
            c = V((r * math.cos(ang), y, r * math.sin(ang)))
            tang = V((-math.sin(ang), 0, math.cos(ang)))
            return c + tang * (v - 0.5) * 0.05 * (1 - 0.8 * u)
        surf(arms, 16, 1, ten, wrap=False, mat=1, kind='stone', base=lambda p, n: (1, 1, 1))
    export_parts('jelly', [('Bell', bell, V(0, 0, 0), None), ('Arms', arms, V(0, 0, 0), None), ('Core', core, V(0, 0, 0), None)],
                 [('Bell', (1, 1, 1, 1), None, True, 0.3), ('Arms', (1, 1, 1, 1), None, True, 0.4), ('Core', (1, 1, 1, 1), (1, 1, 1, 1), False, 0.4)])
    # indices matériaux : 0 Bell, 1 Arms ; Core = 2 (via kind 'glow' -> mat 2)


# ─── Poissons (nez vers +x, tail pivot en x = -0.35) ─────────────────────────
def fish(name, H, W, body_col, tail_col, fin_col, eye=0.06, dorsal=(1.0, 1.0), anal=(0.8, 1.0), photophores=False,
         bar=None, tail_len=0.3, tail_flare=1.0, belly=0.0):
    body, tail = Builder(11), Builder(12)
    X0, X1 = 0.5, -0.35

    def prof(u):
        # 0 museau, ~0.3 maximum, 1 pédoncule
        a = math.sin(math.pi * min(1, u ** 0.6) * 0.999)
        return max(0.05, a ** 0.7 * (1 - 0.45 * u) + 0.12 * (1 - u) ** 6)

    def bfn(u, v):
        th = 2 * math.pi * v
        x = X0 + (X1 - X0) * u
        p = prof(u)
        return V((x, H * p * math.cos(th) - belly * H * p * max(0, -math.cos(th)) * -0.1, W * p * math.sin(th)))

    surf(body, 26, 20, bfn, mat=0, kind='stone', base=body_col)
    topy = lambda x: H * prof((X0 - x) / (X0 - X1))  # noqa: E731
    # nageoire dorsale / anale
    d0, d1 = dorsal
    poly(body, [(0.24, topy(0.24) * 0.95, 0), (0.12, topy(0.12) + 0.3 * H * d0, 0), (-0.08, topy(-0.08) + 0.22 * H * d0, 0),
                (-0.3, topy(-0.3) * 1.0, 0)], mat=0, base=fin_col)
    poly(body, [(0.05, -topy(0.05) * 0.95, 0), (-0.05, -topy(-0.05) - 0.28 * H * anal[0], 0), (-0.22, -topy(-0.22) - 0.18 * H * anal[0], 0),
                (-0.3, -topy(-0.3), 0)], mat=0, base=fin_col)
    # pectorales
    for sg in (-1, 1):
        poly(body, [(0.22, -0.03 * H, sg * W * 0.9 * prof(0.2)), (0.06, -0.3 * H, sg * W * 2.2), (0.02, 0.0, sg * W * 0.7)], mat=0, base=fin_col)
    # yeux
    for sg in (-1, 1):
        boulder(body, (0.34, H * 0.1, sg * W * 0.82 * prof(0.1) * 1.0), eye, (1, 1, 0.6), segs=7, rings=4, jit=0.02, kind='stone',
                base=lambda p, n: (0.01, 0.01, 0.015))
    # queue
    s = tail_flare
    L = tail_len
    poly(tail, [(0.0, 0.05 * H, 0), (-L * 0.8, 0.5 * L * s, 0), (-L, 0.4 * L * s, 0), (-L * 0.62, 0.02, 0), (0.0, 0.0, 0)], mat=0, base=tail_col)
    poly(tail, [(0.0, -0.05 * H, 0), (-L * 0.8, -0.5 * L * s, 0), (-L, -0.4 * L * s, 0), (-L * 0.62, -0.02, 0), (0.0, 0.0, 0)], mat=0, base=tail_col)
    poly(tail, [(0.02, 0.05 * H, 0), (-L * 0.62, 0.02, 0), (-L * 0.62, -0.02, 0), (0.02, -0.05 * H, 0)], mat=0, base=tail_col)
    if photophores:
        for sg in (-1, 1):
            for i in range(7):
                x = 0.3 - i * 0.09
                boulder(body, (x, -H * prof((X0 - x) / (X0 - X1)) * 0.62, sg * W * prof((X0 - x) / (X0 - X1)) * 0.78), 0.016, segs=5, rings=3, jit=0, kind='glow')
        for i in range(2):
            boulder(body, (0.1 - i * 0.2, H * prof(0.5) * 1.0, 0), 0.02, segs=5, rings=3, jit=0, kind='glow')
    export_parts(name, [('Body', body, V(0, 0, 0), None), ('Tail', tail, V(X1, 0, 0), 'Body')],
                 [('Fish', (1, 1, 1, 1), None, True, 0.55), ('Rune', (1, 1, 1, 1), None, False, 0.5), ('Glow', (0.4, 1, 0.9, 1), (0.4, 1, 0.9, 1), False, 0.4)])


def make_fishes():
    def banded(x, bands, c0, c1, soft=0.04):
        return None
    # poisson-ange : doré à bandes bleu-nuit
    def angel(p, n):
        band = 0.5 + 0.5 * math.sin((p.x + 0.5) * 17.0)
        base = mix((0.95, 0.62, 0.08), (0.08, 0.12, 0.35), clamp((band - 0.55) * 4))
        return mix(base, (1.0, 0.9, 0.6), clamp(-p.y * 2.0) * 0.5)
    fish('reef_angel', 0.62, 0.075, angel, lambda p, n: (0.95, 0.55, 0.06), lambda p, n: mix((0.1, 0.18, 0.55), (0.95, 0.7, 0.1), clamp(p.x + 0.3)),
         eye=0.055, dorsal=(1.6, 1), anal=(1.4, 1), tail_len=0.25, tail_flare=0.8)

    # chirurgien bleu : bleu royal, palette noire, queue jaune
    def tang(p, n):
        b = (0.03, 0.2, 0.95)
        pal = clamp(1 - abs((p.y - 0.02) - 0.12 * math.sin((p.x + 0.1) * 7)) * 11) * clamp(p.x * 6 + 1.2) * (1 if p.x < 0.35 else 0)
        c = mix(b, (0.02, 0.02, 0.1), pal * 0.95)
        return mix(c, (0.5, 0.75, 1.0), clamp(-p.y * 2.2) * 0.35)
    fish('reef_tang', 0.42, 0.1, tang, lambda p, n: (1.0, 0.85, 0.05), lambda p, n: (0.02, 0.15, 0.8), eye=0.055, tail_len=0.3, tail_flare=1.15,
         dorsal=(0.9, 1), anal=(0.7, 1))

    # poisson-papillon : jaune, avant blanc, barre noire sur l'œil, tache sur la queue
    def butter(p, n):
        c = (1.0, 0.8, 0.05)
        c = mix(c, (0.95, 0.95, 0.9), clamp((p.x - 0.1) * 9) * (1 if p.x > 0.1 else 0))
        c = mix(c, (0.02, 0.02, 0.03), clamp(1 - abs(p.x - 0.3) * 20) * 0.95)
        return mix(c, (1, 1, 0.9), clamp(-p.y * 3) * 0.35)
    fish('reef_butter', 0.5, 0.085, butter, lambda p, n: (1.0, 0.8, 0.1), lambda p, n: (1.0, 0.75, 0.05), eye=0.056, tail_len=0.22, tail_flare=0.75,
         dorsal=(1.1, 1), anal=(0.9, 1))

    # poisson-lanterne : argenté sombre, photophores lumineux
    def lantern(p, n):
        c = mix((0.07, 0.1, 0.17), (0.4, 0.5, 0.6), clamp(-p.y * 5 + 0.3))
        return c
    fish('lantern', 0.3, 0.1, lantern, lambda p, n: (0.06, 0.09, 0.16), lambda p, n: (0.08, 0.12, 0.2), eye=0.065, tail_len=0.3, tail_flare=1.0,
         dorsal=(0.8, 1), anal=(0.6, 1), photophores=True)


# ─── Roches stratifiées ──────────────────────────────────────────────────────
def rock_colour(seed, strata=3.2):
    def f(p, n):
        h = hsh(round(p.x * 3, 1), round(p.y * 3, 1), round(p.z * 3, 1), seed)
        band = 0.5 + 0.5 * math.sin(p.y * strata * math.pi + 1.7 * math.sin(p.x * 1.6 + seed) + hsh(0, round(p.y * 6), seed, 2) * 1.5)
        lum = 0.66 + 0.26 * band + 0.14 * (h - 0.5)
        lum *= 0.86 + 0.2 * clamp(n.y)   # dessus plus clair
        lum *= 1 - 0.3 * clamp(-n.y)
        c = (lum * 0.98, lum, lum * 0.96)
        moss = clamp(n.y * 0.7 + (hsh(p.x * 0.8, p.z * 0.8, seed, 5) - 0.6)) ** 2
        return mix(c, (lum * 0.5, lum * 0.8, lum * 0.5), moss * 0.5)
    return f


def rock_blob(b, c, r, sc, seed, jit=0.2, segs=12, rings=8):
    boulder(b, c, r, sc, segs=segs, rings=rings, jit=jit, seed=seed, base=rock_colour(seed))


def make_rocks():
    # a : bloc lourd aux flancs vifs
    b = Builder(21)
    rock_blob(b, (0, 0, 0), 1.0, (1, 0.9, 0.95), 1, 0.15, 14, 9)
    export_parts('rock_a', [('Rock', b, V(0, 0, 0), None)], [('Rock', (1, 1, 1, 1), None, True, 0.95)])
    # b : tour sédimentaire
    b = Builder(22)
    y = -0.9
    for i, (w, h) in enumerate(((1.0, 0.45), (0.9, 0.4), (0.78, 0.42), (0.62, 0.38), (0.42, 0.34))):
        rock_blob(b, (0.06 * i - 0.1, y + h, 0.04 * i), w, (1, h / w * 1.1, 0.9), 10 + i, 0.16, 10, 6)
        y += h * 1.5
    export_parts('rock_b', [('Rock', b, V(0, 0, 0), None)], [('Rock', (1, 1, 1, 1), None, True, 0.95)])
    # c : aiguille
    b = Builder(23)

    def spire(u, v):
        th = 2 * math.pi * v
        r = (1 - u) ** 0.8 * (0.8 + 0.25 * math.sin(th * 3 + u * 3)) * (1 + 0.1 * math.sin(u * 15)) * (1 + 0.18 * (hsh(round(v * 11), round(u * 9), 3) - 0.5))
        return V((r * math.cos(th) + 0.18 * u, -1 + 2 * u * 1.15, r * math.sin(th)))
    surf(b, 9, 11, spire, mat=0, kind='stone', base=rock_colour(33, 3.8))
    rock_blob(b, (0.55, -0.7, 0.35), 0.45, (1, 0.7, 1), 34, 0.2, 8, 5)
    export_parts('rock_c', [('Rock', b, V(0, 0, 0), None)], [('Rock', (1, 1, 1, 1), None, True, 0.95)])
    # d : amas de trois blocs
    b = Builder(24)
    rock_blob(b, (-0.45, -0.1, 0), 0.75, (1, 0.9, 1), 41, 0.22, 10, 7)
    rock_blob(b, (0.5, -0.2, 0.1), 0.7, (1, 0.85, 0.95), 42, 0.22, 10, 7)
    rock_blob(b, (0.05, 0.35, -0.15), 0.6, (1, 0.9, 1), 43, 0.2, 9, 6)
    export_parts('rock_d', [('Rock', b, V(0, 0, 0), None)], [('Rock', (1, 1, 1, 1), None, True, 0.95)])
    # e : corniche en surplomb
    b = Builder(25)

    def shelf(u, v):
        th = 2 * math.pi * v
        ph = u * math.pi
        r = math.sin(ph)
        top = math.cos(ph)
        x, z = 1.15 * r * math.cos(th), 0.9 * r * math.sin(th)
        y = (0.5 if top > 0 else 0.9) * top + 0.07 * math.sin(x * 4 + z * 3)
        if top > 0:
            y = y * 0.6
        return V((x * (1 + 0.1 * math.sin(th * 4 + u * 5)), y, z))
    surf(b, 10, 14, shelf, mat=0, kind='stone', base=rock_colour(51, 4.5))
    export_parts('rock_e', [('Rock', b, V(0, 0, 0), None)], [('Rock', (1, 1, 1, 1), None, True, 0.95)])


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    jelly()
    make_fishes()
    make_rocks()
