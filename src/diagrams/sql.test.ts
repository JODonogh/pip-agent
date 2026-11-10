import { describe, expect, it } from 'vitest';
import { parseSql, sqlCostDiagram, sqlCostFactors, sqlFlowDiagram } from './sql';
import { visualise } from './visualise';

const QUERY = `@Query(value = """
        SELECT p.*
        FROM gpp.partner p
        WHERE (
          (CAST(:status AS TEXT) IS NULL AND p.deleted_at IS NULL)
          OR (CAST(:status AS TEXT) = 'ACTIVE' AND p.deleted_at IS NULL AND p.partner_status = 'ACTIVE')
          OR (CAST(:status AS TEXT) = 'SUSPENDED' AND p.deleted_at IS NULL AND p.partner_status = 'SUSPENDED')
          OR (CAST(:status AS TEXT) = 'OFFBOARDED' AND p.deleted_at IS NOT NULL)
          OR (CAST(:status AS TEXT) = 'IDP_CONFIGURED' AND p.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM gpp.partner_idp_configuration c
              WHERE c.partner_id = p.id AND c.portal_idp_enabled = TRUE))
          OR (CAST(:status AS TEXT) = 'API_CLIENT_CREATED' AND p.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM gpp.api_client a WHERE a.partner_id = p.id))
          OR (CAST(:status AS TEXT) = 'CERTIFICATES_UPLOADED' AND p.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM gpp.partner_certificate c WHERE c.partner_id = p.id))
        )
        AND (:restrictToScope = FALSE OR p.id IN (:partnerIds))
        AND (CAST(:productId AS uuid) IS NULL OR EXISTS (
          SELECT 1 FROM gpp.partner_products partnerProduct
          WHERE partnerProduct.partner_id = p.id AND partnerProduct.product_id = CAST(:productId AS uuid)))
        AND (CAST(:search AS TEXT) IS NULL
          OR LOWER(p.partner_name) LIKE '%' || LOWER(CAST(:search AS TEXT)) || '%' ESCAPE '\\\\'
          OR LOWER(p.workday_id) LIKE '%' || LOWER(CAST(:search AS TEXT)) || '%' ESCAPE '\\\\'
          OR LOWER(CAST(p.id AS TEXT)) LIKE '%' || LOWER(CAST(:search AS TEXT)) || '%' ESCAPE '\\\\')
        ORDER BY LOWER(p.partner_name) ASC, p.id ASC
      """,
      nativeQuery = true)
Page<Partner> findFiltered(String status, Pageable pageable);`;

const ctx = { file: 'PartnerRepository.java', line: 105, language: 'java', selection: QUERY, surrounding: '' };

describe('SQL reader', () => {
  const query = parseSql(QUERY)!;

  it('reads tables, parameters, filters and ordering from the text block', () => {
    expect(query.main).toMatchObject({ name: 'gpp.partner', alias: 'p' });
    expect(query.params.map((param) => param.name)).toEqual(['status', 'restrictToScope', 'partnerIds', 'productId', 'search']);
    expect(query.params.find((param) => param.name === 'productId')).toMatchObject({ type: 'UUID', optional: true });
    expect(query.params.find((param) => param.name === 'partnerIds')?.list).toBe(true);
    expect(query.filters).toHaveLength(4);
    expect(query.filters[0]).toMatchObject({ params: ['status'], alternatives: 7 });
    expect(query.filters[0]!.subqueries.map((table) => table.name)).toEqual(['gpp.partner_idp_configuration', 'gpp.api_client', 'gpp.partner_certificate']);
    expect(query.filters[0]!.subqueries[1]!.columns).toEqual(['partner_id']);
    expect(query.filters[2]!.subqueries[0]!.columns).toEqual(expect.arrayContaining(['partner_id', 'product_id']));
    expect(query.orderBy).toBe('LOWER(p.partner_name) ASC, p.id ASC');
    expect(query.select).toBe('p.*');
  });

  it('ignores prose that merely contains the words select and from', () => {
    expect(parseSql('Select the file from the list and press go')).toBeNull();
    expect(parseSql('const x = 1;')).toBeNull();
  });

  it('draws parameters and subqueries flowing into filters, then the table, the sort and the result', () => {
    const flow = sqlFlowDiagram(query, 'java');
    const tags = Object.fromEntries(flow.nodes.map((node) => [node.id, node.tag]));
    expect(flow.nodes.filter((node) => node.tag === 'parameter')).toHaveLength(5);
    expect(flow.nodes.filter((node) => node.tag === 'filter')).toHaveLength(4);
    expect(flow.nodes.filter((node) => node.tag === 'exists')).toHaveLength(4);
    expect(tags['sql:order']).toBe('order by');
    expect(flow.edges).toEqual(expect.arrayContaining([
      { from: 'sql:param:status', to: 'sql:filter:0' },
      { from: 'sql:filter:0', to: 'sql:table' },
      { from: 'sql:table', to: 'sql:order' },
      { from: 'sql:order', to: 'sql:result' },
    ]));
    const ids = new Set(flow.nodes.map((node) => node.id));
    expect(flow.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to))).toBe(true);
  });

  it('turns the performance view into cards about this query, riskiest first, with no measured numbers', () => {
    const titles = sqlCostFactors(query).map((factor) => factor.title);
    expect(titles[0]).toBe('Search with a leading %');
    expect(titles).toEqual(expect.arrayContaining(['Optional filters share one plan', 'Casting a column', 'EXISTS per candidate row', '7 OR alternatives on :status', 'Sorting on LOWER(p.partner_name)', 'No LIMIT in this text']));
    const exists = sqlCostFactors(query).find((factor) => factor.title === 'EXISTS per candidate row')!;
    expect(exists.body).toContain('gpp.partner_products(partner_id, product_id)');
    const cards = sqlCostDiagram(query, 'java');
    expect(cards.series).toBeUndefined();
    expect(cards.nodes.at(-1)!.label).toBe('Check before changing anything');
    expect(cards.caption).toContain('not measurements');
  });

  it('replaces the generic data flow and growth curves in the Visualise views', () => {
    const views = visualise(ctx);
    expect(views.dataFlow.nodes.some((node) => node.tag === 'filter')).toBe(true);
    expect(views.availableTypes).toEqual(expect.arrayContaining(['dataFlow', 'growth']));
    expect(views.growth.series).toBeUndefined();
    expect(views.growth.nodes[0]!.tone).toBe('risk');
  });
});
