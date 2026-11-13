import { describe, expect, it } from 'vitest';
import { grpcIssues, sqlIssues } from './syntax';

describe('avisos de sintaxis del intercambio (spec interacciones)', () => {
  it('un query correcto con sus parámetros documentados no da avisos', () => {
    expect(sqlIssues("SELECT saldo FROM cuentas WHERE id = :cuenta AND tipo = 'it''s' -- comentario (", 'sql', ['cuenta'])).toEqual([]);
    expect(sqlIssues('SELECT x::text FROM t WHERE @@ROWCOUNT > 0', 'sql')).toEqual([]);
    expect(sqlIssues('lo que sea', 'text')).toEqual([]);
  });

  it('señala comillas y paréntesis sin cerrar, un comienzo raro y UPDATE o DELETE sin WHERE', () => {
    expect(sqlIssues("SELECT 'abc FROM t", 'sql')).toContain('Hay una comilla simple sin cerrar.');
    expect(sqlIssues('SELECT count(* FROM t', 'sql')).toContain('Falta cerrar un paréntesis.');
    expect(sqlIssues('SELECT a) FROM t', 'sql')).toContain('Sobra un paréntesis de cierre.');
    expect(sqlIssues('SELEC a FROM t', 'sql')[0]).toContain('«SELEC»');
    expect(sqlIssues('UPDATE cuentas SET saldo = 0; DELETE FROM t WHERE id = 1', 'sql')).toEqual(['UPDATE sin WHERE: afecta a todas las filas.']);
  });

  it('señala los parámetros usados que no están documentados', () => {
    expect(sqlIssues('SELECT * FROM t WHERE a = :cuenta AND b = @canal AND c = :cuenta', 'sql', ['canal'])).toEqual([
      'Parámetro usado sin documentar: :cuenta. Agrégalos en «Parámetros».',
    ]);
    expect(sqlIssues('CALL pagar(:monto, :cuenta)', 'procedure')[0]).toContain(':monto, :cuenta');
  });

  it('valida los nombres de gRPC', () => {
    expect(grpcIssues('cuentas.v1.Cuentas', 'ObtenerSaldo')).toEqual([]);
    expect(grpcIssues('cuentas/v1', 'Obtener Saldo')).toHaveLength(2);
    expect(grpcIssues(undefined, undefined)).toEqual([]);
  });
});
