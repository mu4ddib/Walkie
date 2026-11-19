import json, re, sys
from collections import Counter
S = sys.argv[1]
truth = json.load(open(f"{S}/corpus/ground_truth.json"))
norm = lambda u: re.sub(r"\{[^}]*\}", "{}", u)
exp_routes = Counter((r["file"], r["path"]) for r in truth["routes"])
exp_http = Counter((h["file"], h["method"], norm(h["url"])) for h in truth["http"])
exp_dyn = {(d["file"]) for d in truth["dynamicRoutes"] + truth["dynamicHttp"]}
print(f"{'opción':<11}{'rutas':>8}{'FP rutas':>10}{'HTTP':>8}{'FP HTTP':>9}{'dinámicas':>11}{'errores':>9}{'ms':>8}{'MB':>6}")
for mode in ["scanner", "treesitter", "jint"]:
    r = json.load(open(f"{S}/r-{mode}.json"))
    got_routes = Counter((f["File"], p) for f in r["results"] for p in f["Routes"])
    got_http = Counter((f["File"], c["Method"], norm(c["Url"])) for f in r["results"] for c in f["Http"])
    dyn_files = {f["File"] for f in r["results"] if f["Dynamic"]}
    tp_r = sum((got_routes & exp_routes).values()); fp_r = sum((got_routes - exp_routes).values())
    tp_h = sum((got_http & exp_http).values()); fp_h = sum((got_http - exp_http).values())
    dyn = len(exp_dyn & dyn_files)
    print(f"{mode:<11}{tp_r:>4}/{sum(exp_routes.values()):<3}{fp_r:>10}{tp_h:>4}/{sum(exp_http.values()):<3}{fp_h:>9}{dyn:>7}/{len(exp_dyn):<3}{r['filesWithErrors']:>9}{r['runMs']+r['setupMs']:>8}{r['peakWorkingSetMb']:>6}")
    for k in (got_routes - exp_routes): print("   FP ruta:", k)
    for k in (exp_routes - got_routes): print("   falta ruta:", k)
    for k in (got_http - exp_http): print("   FP http:", k)
    for k in (exp_http - got_http): print("   falta http:", k)
