#!/usr/bin/env python3
"""Corpus de la prueba de concepto de ADR-0013 (tarea 8): proyectos ficticios de React y Angular con la verdad conocida.

Escribe <salida>/{react-router,next-app,next-pages,angular-standalone,angular-ngmodule,filler} y ground_truth.json.
Determinista: el mismo comando da los mismos archivos. Uso: gen_corpus.py <salida> [archivos_de_relleno]
"""
import json
import os
import sys

out = sys.argv[1]
filler_count = int(sys.argv[2]) if len(sys.argv) > 2 else 1900
truth = {"routes": [], "http": [], "screensByFolder": [], "dynamicRoutes": [], "dynamicHttp": []}


def write(path, text):
    full = os.path.join(out, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(text.lstrip("\n"))


def route(file, raw):
    truth["routes"].append({"file": file, "path": raw})


def http(file, method, url):
    truth["http"].append({"file": file, "method": method, "url": url})


# ---------------- React Router ----------------
f = "react-router/src/main.tsx"
write(f, """
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Layout } from './Layout';
import { Home } from './pages/Home';
import { Pedidos } from './pages/Pedidos';
import { Pedido } from './pages/Pedido';
import { Login } from './pages/Login';

// Una ruta comentada no existe: <Route path="/comentada" element={<Home />} />
/* { path: '/bloque-comentado', element: <Home /> } */
const ayuda = "{ path: '/en-un-texto' }";
const patron = /path: '\\/en-una-regex'/;

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'pedidos', element: <Pedidos /> },
      { path: 'pedidos/:pedidoId', element: <Pedido />, loader: ({ params }) => fetch(`/api/pedidos/${params.pedidoId}`) },
      { path: 'clientes', lazy: () => import('./pages/Clientes') },
    ],
  },
  { path: '/login', Component: Login },
  { path: '*', element: <p>No existe: don't panic</p> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
""")
for p in ["/", "pedidos", "pedidos/:pedidoId", "clientes", "/login", "*"]:
    route(f, p)
http(f, "GET", "/api/pedidos/{}")

f = "react-router/src/AppRoutes.jsx"
write(f, """
import { Routes, Route, Link } from 'react-router-dom';
import { Admin, Usuarios, Usuario, Reportes } from './admin';

const dinamica = window.location.hash.slice(1);

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/admin" element={<Admin />}>
        <Route path="usuarios" element={<Usuarios />} />
        <Route path="usuarios/:id" element={<Usuario />} />
      </Route>
      <Route path={dinamica} element={<Reportes />} />
      <Route path='/reportes' element={<Reportes />} />
    </Routes>
  );
}

export function Menu() {
  return (
    <nav>
      <p>Don't click twice; it's fine</p>
      <Link to="/admin/usuarios">Usuarios</Link>
      <Link to={`/admin/usuarios/${1}`}>Primero</Link>
    </nav>
  );
}
""")
for p in ["/admin", "usuarios", "usuarios/:id", "/reportes"]:
    route(f, p)
truth["dynamicRoutes"].append({"file": f, "expr": "dinamica"})

f = "react-router/src/pages/Pedidos.tsx"
write(f, """
import axios from 'axios';
import { useEffect, useState } from 'react';

const BASE = '/api/v2';

interface Pedido { id: string; total: number }

export function Pedidos() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  useEffect(() => {
    fetch('/api/pedidos').then((r) => r.json()).then(setPedidos);
  }, []);

  async function crear(p: Pedido) {
    await fetch('/api/pedidos', { method: 'POST', body: JSON.stringify(p) });
  }

  async function borrar(id: string) {
    await axios.delete(`/api/pedidos/${id}`);
  }

  async function facturas() {
    return axios.get(`${BASE}/facturas`);
  }

  async function desconocida(url: string) {
    return fetch(url);
  }

  // fetch('/api/comentada')
  const total = pedidos.reduce((a, p) => a + p.total, 0) / 2;
  const re = /\\/api\\/regex/g;
  return <div title="fetch('/api/en-atributo')">{total} {String(re)}</div>;
}
""")
http(f, "GET", "/api/pedidos")
http(f, "POST", "/api/pedidos")
http(f, "DELETE", "/api/pedidos/{}")
http(f, "GET", "/api/v2/facturas")
truth["dynamicHttp"].append({"file": f, "expr": "url"})

f = "react-router/src/pages/Clientes.ts"
write(f, """
import axios from 'axios';
const api = import.meta.env.VITE_API;
export async function loader() {
  const lista = await axios.get('/api/clientes');
  await axios.post(`${api}/clientes`, {});
  return lista;
}
""")
http(f, "GET", "/api/clientes")
truth["dynamicHttp"].append({"file": f, "expr": "api"})

write("react-router/src/Roto.tsx", """
export function Roto() {
  return <div>
    <Route path="/rota" element={<X />
  ;
""")
write("react-router/package.json", json.dumps({"name": "tienda-web", "dependencies": {"react": "^19.0.0", "react-router-dom": "^7.0.0", "axios": "^1.7.0"}}, indent=2))

# ---------------- Next.js App Router ----------------
for path in ["page.tsx", "pedidos/page.tsx", "pedidos/[id]/page.tsx", "(marketing)/acerca/page.tsx", "docs/[...slug]/page.tsx"]:
    write(f"next-app/app/{path}", "export default function Page() { return <main>Página</main>; }\n")
write("next-app/app/layout.tsx", "export default function RootLayout({ children }) { return <html><body>{children}</body></html>; }\n")
write("next-app/app/_privado/page.tsx", "export default function Oculta() { return null; }\n")
write("next-app/app/api/pedidos/route.ts", "export async function GET() { return Response.json([]); }\nexport async function POST(req: Request) { return Response.json({}); }\n")
write("next-app/package.json", json.dumps({"name": "next-app", "dependencies": {"next": "15.0.0", "react": "^19.0.0"}}, indent=2))
truth["screensByFolder"] += [{"app": "next-app", "route": r} for r in ["/", "/pedidos", "/pedidos/[id]", "/acerca", "/docs/[...slug]"]]

# ---------------- Next.js Pages Router ----------------
for path in ["index.tsx", "pedidos/index.tsx", "pedidos/[id].tsx", "404.tsx"]:
    write(f"next-pages/pages/{path}", "export default function Page() { return <main>Página</main>; }\n")
write("next-pages/pages/_app.tsx", "export default function App({ Component, pageProps }) { return <Component {...pageProps} />; }\n")
write("next-pages/pages/api/hola.ts", "export default function handler(req, res) { res.status(200).json({}); }\n")
write("next-pages/package.json", json.dumps({"name": "next-pages", "dependencies": {"next": "14.2.0", "react": "^18.0.0"}}, indent=2))
truth["screensByFolder"] += [{"app": "next-pages", "route": r} for r in ["/", "/pedidos", "/pedidos/[id]"]]

# ---------------- Angular standalone ----------------
f = "angular-standalone/src/app/app.routes.ts"
write(f, """
import { Routes } from '@angular/router';
import { HomeComponent } from './home/home.component';
import { PedidosComponent } from './pedidos/pedidos.component';
import { PedidoComponent } from './pedidos/pedido.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  {
    path: 'pedidos',
    component: PedidosComponent,
    children: [{ path: ':id', component: PedidoComponent }],
  },
  { path: 'admin', loadChildren: () => import('./admin/admin.routes').then((m) => m.ADMIN_ROUTES) },
  { path: 'perfil', loadComponent: () => import('./perfil/perfil.component').then((m) => m.PerfilComponent) },
  { path: '**', redirectTo: '' },
];
""")
for p in ["", "pedidos", ":id", "admin", "perfil", "**"]:
    route(f, p)
f = "angular-standalone/src/app/admin/admin.routes.ts"
write(f, """
import { Routes } from '@angular/router';
import { AdminComponent } from './admin.component';
import { UsuariosComponent } from './usuarios.component';

export const ADMIN_ROUTES: Routes = [
  { path: '', component: AdminComponent },
  { path: 'usuarios', component: UsuariosComponent },
];
""")
for p in ["", "usuarios"]:
    route(f, p)
write("angular-standalone/src/main.ts", """
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';

bootstrapApplication(AppComponent, { providers: [provideRouter(routes), provideHttpClient()] });
""")
f = "angular-standalone/src/app/pedidos/pedidos.service.ts"
write(f, """
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class PedidosService {
  private readonly http = inject(HttpClient);

  listar() { return this.http.get<Pedido[]>('/api/pedidos'); }
  crear(p: Pedido) { return this.http.post<Pedido>('/api/pedidos', p); }
  borrar(id: string) { return this.http.delete(`/api/pedidos/${id}`); }
  actualizar(id: string, p: Pedido) { return this.http.put(`/api/pedidos/${id}`, p); }
  clientes() { return this.http.get(`${environment.apiUrl}/clientes`); }
}
""")
http(f, "GET", "/api/pedidos")
http(f, "POST", "/api/pedidos")
http(f, "DELETE", "/api/pedidos/{}")
http(f, "PUT", "/api/pedidos/{}")
truth["dynamicHttp"].append({"file": f, "expr": "environment.apiUrl"})
write("angular-standalone/src/app/pedidos/pedidos.component.html", """
<a routerLink="/pedidos/nuevo">Nuevo</a>
<a [routerLink]="['/pedidos', p.id]" *ngFor="let p of pedidos">{{ p.id }}</a>
<a routerLink="/perfil">Perfil</a>
""")
write("angular-standalone/package.json", json.dumps({"name": "tienda-angular", "dependencies": {"@angular/core": "^19.0.0", "@angular/router": "^19.0.0"}}, indent=2))

# ---------------- Angular NgModule ----------------
f = "angular-ngmodule/src/app/app-routing.module.ts"
write(f, """
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { InicioComponent } from './inicio/inicio.component';

const routes: Routes = [
  { path: 'inicio', component: InicioComponent },
  { path: 'ventas', loadChildren: () => import('./ventas/ventas.module').then((m) => m.VentasModule) },
  { path: '', redirectTo: 'inicio', pathMatch: 'full' },
];

@NgModule({ imports: [RouterModule.forRoot(routes)], exports: [RouterModule] })
export class AppRoutingModule {}
""")
for p in ["inicio", "ventas", ""]:
    route(f, p)
f = "angular-ngmodule/src/app/ventas/ventas-routing.module.ts"
write(f, """
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { VentasComponent } from './ventas.component';
import { VentaComponent } from './venta.component';

@NgModule({
  imports: [RouterModule.forChild([
    { path: '', component: VentasComponent },
    { path: ':ventaId', component: VentaComponent },
  ])],
})
export class VentasRoutingModule {}
""")
for p in ["", ":ventaId"]:
    route(f, p)
write("angular-ngmodule/src/app/ventas/ventas.module.ts", """
import { NgModule } from '@angular/core';
import { VentasRoutingModule } from './ventas-routing.module';
import { VentasComponent } from './ventas.component';

@NgModule({ declarations: [VentasComponent], imports: [VentasRoutingModule] })
export class VentasModule {}
""")
write("angular-ngmodule/src/app/ventas/ventas.component.ts", """
import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';

@Component({ selector: 'app-ventas', templateUrl: './ventas.component.html' })
export class VentasComponent {
  constructor(private router: Router, private http: HttpClient) {}
  abrir(id: number) { this.router.navigate(['/ventas', id]); }
  resumen() { return this.http.get('/api/ventas/resumen'); }
}
""")
http("angular-ngmodule/src/app/ventas/ventas.component.ts", "GET", "/api/ventas/resumen")
write("angular-ngmodule/src/app/ventas/ventas.component.html", """
<a routerLink="/inicio">Volver</a>
<a [routerLink]="['/ventas', v.id]" *ngFor="let v of ventas">{{ v.id }}</a>
""")
f = "angular-ngmodule/src/app/ventas/ventas.service.ts"
write(f, """
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable()
export class VentasService {
  constructor(private http: HttpClient) {}
  listar() { return this.http.get('/api/ventas'); }
  anular(id: number) { return this.http.patch(`/api/ventas/${id}/anular`, {}); }
}
""")
http(f, "GET", "/api/ventas")
http(f, "PATCH", "/api/ventas/{}/anular")
write("angular-ngmodule/package.json", json.dumps({"name": "ventas-angular", "dependencies": {"@angular/core": "^17.0.0"}}, indent=2))

# ---------------- Casos difíciles para un escáner (ronda 2) ----------------
f = "hard/src/rutas-dificiles.tsx"
write(f, """
import { createBrowserRouter, Route, Routes } from 'react-router-dom';
import type { ComponentType } from 'react';

interface RutaPropia { path: string; component: ComponentType; children?: RutaPropia[] }
type Otra = { path: string; element: JSX.Element };
const id = <T,>(x: T): T => x;
const ratio = (a: number, b: number) => a / b / 2;
const barras = /[/]+/g;
const anidada = `x${`y${'}'}`}z`;
const base = { element: <div /> };

export const router = createBrowserRouter([
  { ...base, path: '/con-spread', element: <Spread /> },
  { path: `/plantilla-literal`, element: <Literal /> },
  { path: '/guardada', element: <Guardada />, loader: () => id(ratio(4, 2)) },
]);

export function Condicional({ a, b }: { a: number; b: number }) {
  return (
    <Routes>
      {/* <Route path="/en-comentario-jsx" element={<Nada />} /> */}
      {a < b ? <Route path="/condicional" element={<Si />} /> : null}
      <Route path="/despues" element={<Despues titulo={`a > b: ${a > b}`} />} />
    </Routes>
  );
}
""")
for p in ["/con-spread", "/plantilla-literal", "/guardada", "/condicional", "/despues"]:
    route(f, p)

f = "hard/src/llamadas-dificiles.ts"
write(f, """
import axios from 'axios';
import { HttpClient } from '@angular/common/http';

export class Datos {
  constructor(private http: HttpClient) {}
  generico() { return this.http.get<Array<Map<string, Array<number>>>>('/api/generico'); }
  conDivision(total: number) { const mitad = total / 2 / 1; return this.http.post('/api/division', { mitad }); }
  conRegex(s: string) { const ok = /^\\/api\\/(x|y)$/.test(s); return ok ? axios.put('/api/regex-ok', {}) : null; }
  comentario() { /* this.http.get('/api/comentado') */ return axios.get('/api/tras-comentario'); }
}
""")
http(f, "GET", "/api/generico")
http(f, "POST", "/api/division")
http(f, "PUT", "/api/regex-ok")
http(f, "GET", "/api/tras-comentario")

f = "hard/src/angular-dificil.routes.ts"
write(f, """
import { Routes } from '@angular/router';
import { authGuard } from './auth.guard';

type Meta = { path: string; title: string };
export const RUTAS: Routes = [
  { path: `literal`, component: LiteralComponent, canActivate: [authGuard], data: { title: 'Título con {llaves} y "comillas"' } },
  { path: 'padre', component: PadreComponent, children: [{ path: 'hijo', component: HijoComponent, resolve: { x: () => 1 / 2 } }] },
];
""")
for p in ["literal", "padre", "hijo"]:
    route(f, p)

# ---------------- Relleno: componentes realistas sin rutas ni llamadas ----------------
template = """
import {{ useMemo, useState }} from 'react';

type Fila{n} = {{ id: number; nombre: string; precio?: number }};
enum Estado{n} {{ Activo = 'activo', Inactivo = 'inactivo' }}

const formato{n} = new Intl.NumberFormat('es-CL', {{ style: 'currency', currency: 'CLP' }});
const patron{n} = /^[a-z]+\\/[0-9]{{2,}}$/i;

function ordenar{n}<T extends {{ nombre: string }}>(filas: T[]): T[] {{
  return [...filas].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}}

export function Tabla{n}({{ filas }}: {{ filas: Fila{n}[] }}) {{
  const [filtro, setFiltro] = useState('');
  const visibles = useMemo(() => ordenar{n}(filas).filter((f) => f.nombre.includes(filtro)), [filas, filtro]);
  const total = visibles.reduce((a, f) => a + (f.precio ?? 0), 0) / 100;
  // Comentario con una ruta que no es ruta: path: '/no'
  return (
    <section className={{`tabla ${{filtro ? 'filtrada' : ''}}`}}>
      <p>Don't show '{{filtro}}' if it's empty</p>
      <input value={{filtro}} onChange={{(e) => setFiltro(e.target.value)}} placeholder="Buscar…" />
      <ul>
        {{visibles.map((f) => (
          <li key={{f.id}} data-estado={{Estado{n}.Activo}}>
            {{f.nombre}} — {{formato{n}.format(f.precio ?? 0)}} {{patron{n}.test(f.nombre) ? '✓' : ''}}
          </li>
        ))}}
      </ul>
      <footer>Total: {{formato{n}.format(total)}}</footer>
    </section>
  );
}}
"""
ng_template = """
import {{ Component, Input, Output, EventEmitter }} from '@angular/core';

@Component({{
  selector: 'app-tarjeta-{n}',
  standalone: true,
  template: `<div class="tarjeta" (click)="elegir.emit(id)">{{{{ titulo }}}}</div>`,
}})
export class Tarjeta{n}Component {{
  @Input() titulo = '';
  @Input() id = {n};
  @Output() elegir = new EventEmitter<number>();
  private readonly cache = new Map<string, number>();
  calcular(valor: number): number {{
    const clave = `v-${{valor}}`;
    if (!this.cache.has(clave)) this.cache.set(clave, valor * 2 / 3);
    return this.cache.get(clave)!;
  }}
}}
"""
for n in range(filler_count):
    if n % 3 == 2:
        write(f"filler/angular/tarjeta-{n}.component.ts", ng_template.format(n=n))
    else:
        write(f"filler/react/Tabla{n}.tsx", template.format(n=n))

with open(os.path.join(out, "ground_truth.json"), "w", encoding="utf-8") as fh:
    json.dump(truth, fh, ensure_ascii=False, indent=2)
print(f"rutas literales: {len(truth['routes'])}, llamadas HTTP literales: {len(truth['http'])}, pantallas por carpetas: {len(truth['screensByFolder'])}")
