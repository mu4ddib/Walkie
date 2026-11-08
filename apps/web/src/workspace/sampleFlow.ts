import { createGraphStore, toGraph } from '../store/graphStore';
import type { WalkieCanvasGraphV0 } from '../schema/walkie-graph';

/** Nombre de la app de ejemplo: lleva "(ejemplo)" para que nunca se confunda con una real. */
export const SAMPLE_APP_NAME = 'Banca de ejemplo (ejemplo)';
export const SAMPLE_FEATURES = ['Iniciar sesión', 'Transferir'] as const;

/**
 * Flujo de muestra para el primer ingreso (spec espacio-de-trabajo, criterio 2): un inicio de sesión
 * con pantalla, regla, API, servicio y base de datos conectados, un portal a "Transferir" y un tour.
 * Datos ficticios. Se arma con las acciones del store, así el grafo siempre cumple el schema.
 */
export function sampleFlow(transferirFeatureId: string): WalkieCanvasGraphV0 {
  const s = createGraphStore().getState;
  const at = (x: number, y: number) => ({ x, y });

  const cliente = s().addNode('actor', at(0, 120));
  s().updateNode(cliente, { title: 'Cliente', description: 'Persona que entra a la banca móvil.' });

  const login = s().addNode('screen', at(320, 96));
  s().updateNode(login, { title: 'Login', description: 'Pide documento y clave.' });

  const regla = s().addNode('rule', at(320, 400));
  s().updateNode(regla, { title: 'Documento válido', expression: 'solo dígitos\nentre 6 y 10\nobligatorio' });
  s().addInput(login, { name: 'documento', type: 'string', required: true, ruleIds: [regla] });
  s().addInput(login, { name: 'clave', type: 'string', required: true });

  const api = s().addNode('api', at(680, 96));
  s().updateNode(api, {
    title: 'Crear sesión',
    description: 'Valida credenciales y devuelve un token.',
    http: { method: 'POST', path: '/auth/sesiones' },
  });

  const servicio = s().addNode('service', at(1040, 96));
  s().updateNode(servicio, { title: 'Servicio de identidad', description: 'Verifica la clave contra el núcleo.' });

  const bd = s().addNode('database', at(1040, 400));
  s().updateNode(bd, { title: 'Clientes', description: 'Datos de acceso de cada cliente.' });

  const portal = s().addNode('portal', at(680, 400));
  s().updateNode(portal, { title: 'Transferir', targetFeatureId: transferirFeatureId });

  s().connect(cliente, login, 'uses');
  const pedir = s().connect(login, api, 'request');
  if (pedir) s().updateEdge(pedir, { label: 'Ingresar', when: 'datos válidos' });
  s().connect(api, servicio, 'request');
  s().connect(servicio, bd, 'reads');
  const ok = s().connect(login, portal, 'navigation');
  if (ok) s().updateEdge(ok, { when: '200' });

  const tour = s().addTour('Cómo entra un cliente');
  if (tour) {
    s().addStep(tour, login, 'El cliente escribe su documento y su clave.');
    s().addStep(tour, regla, 'Antes de llamar a la API, el documento debe tener solo dígitos.');
    s().addStep(tour, api, 'La API recibe las credenciales y pide al servicio de identidad que las verifique.');
    s().addStep(tour, bd, 'El servicio lee los datos de acceso del cliente.');
    s().addStep(tour, portal, 'Con la sesión iniciada, el cliente puede ir a Transferir.');
  }

  return toGraph(s());
}
