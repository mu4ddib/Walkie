import { EntityNode, GroupNode, StubNode } from './ArchitectureNodes';

/** Tipos de caja de la vista de arquitectura (fuera del .tsx para el fast refresh). */
export const architectureNodeTypes = { archGroup: GroupNode, archEntity: EntityNode, archStub: StubNode };
