import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { resolveDataSource } = await import('../../src/services/data-source-service.js');

describe('Data Source Service', () => {
  describe('static data source', () => {
    it('should resolve static options', async () => {
      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'static',
            options: [
              { label: 'A', value: 'a' },
              { label: 'B', value: 'b' },
            ],
          },
        },
        formData: {},
      });
      expect(result.options).toHaveLength(2);
      expect(result.options[0]).toEqual({ label: 'A', value: 'a' });
      expect(result.options[1]).toEqual({ label: 'B', value: 'b' });
      expect(result.total).toBe(2);
    });

    it('should filter static options by search keyword', async () => {
      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'static',
            options: [
              { label: 'Apple', value: 'a' },
              { label: 'Banana', value: 'b' },
            ],
          },
        },
        formData: {},
        searchKeyword: 'app',
      });
      expect(result.options).toHaveLength(1);
      expect(result.options[0].label).toBe('Apple');
      expect(result.total).toBe(1);
    });

    it('should be case-insensitive when filtering', async () => {
      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'static',
            options: [
              { label: 'Apple', value: 'a' },
              { label: 'Banana', value: 'b' },
            ],
          },
        },
        formData: {},
        searchKeyword: 'BAN',
      });
      expect(result.options).toHaveLength(1);
      expect(result.options[0].label).toBe('Banana');
    });

    it('should return empty options for no match', async () => {
      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'static',
            options: [
              { label: 'Apple', value: 'a' },
              { label: 'Banana', value: 'b' },
            ],
          },
        },
        formData: {},
        searchKeyword: 'xyz',
      });
      expect(result.options).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('expression data source', () => {
    it('should resolve expression with form data placeholders', async () => {
      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'expression',
            expression: '{{deptId}}-{{userId}}',
          },
        },
        formData: { deptId: 'D001', userId: 'U123' },
      });
      expect(result.options).toHaveLength(1);
      expect(result.options[0].value).toBe('D001-U123');
      expect(result.options[0].label).toBe('D001-U123');
    });

    it('should replace missing fields with empty string', async () => {
      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'expression',
            expression: '{{deptId}}-{{missing}}',
          },
        },
        formData: { deptId: 'D001' },
      });
      expect(result.options[0].value).toBe('D001-');
    });

    it('should return empty options when expression is missing', async () => {
      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'expression',
          },
        },
        formData: {},
      });
      expect(result.options).toHaveLength(0);
    });
  });

  describe('workflowVar data source', () => {
    it('should resolve workflow variable from array', async () => {
      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'workflowVar',
            variableName: 'approvers',
          },
        },
        formData: { approvers: [{ label: '张三', value: 'u1' }] },
      });
      expect(result.options).toHaveLength(1);
      expect(result.options[0].label).toBe('张三');
      expect(result.options[0].value).toBe('u1');
    });

    it('should resolve workflow variable with workflowVar. prefix', async () => {
      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'workflowVar',
            variableName: 'status',
          },
        },
        formData: { 'workflowVar.status': 'approved' },
      });
      expect(result.options).toHaveLength(1);
      expect(result.options[0].label).toBe('approved');
      expect(result.options[0].value).toBe('approved');
    });

    it('should resolve scalar workflow variable', async () => {
      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'workflowVar',
            variableName: 'count',
          },
        },
        formData: { count: 42 },
      });
      expect(result.options).toHaveLength(1);
      expect(result.options[0].label).toBe('42');
      expect(result.options[0].value).toBe(42);
    });

    it('should return empty options for missing variable', async () => {
      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'workflowVar',
            variableName: 'missing',
          },
        },
        formData: {},
      });
      expect(result.options).toHaveLength(0);
    });

    it('should return empty options when variableName is missing', async () => {
      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'workflowVar',
          },
        },
        formData: { approvers: [] },
      });
      expect(result.options).toHaveLength(0);
    });

    it('should handle array of primitives', async () => {
      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'workflowVar',
            variableName: 'tags',
          },
        },
        formData: { tags: ['tag1', 'tag2'] },
      });
      expect(result.options).toHaveLength(2);
      expect(result.options[0]).toEqual({ label: 'tag1', value: 'tag1' });
      expect(result.options[1]).toEqual({ label: 'tag2', value: 'tag2' });
    });
  });

  describe('remote data source', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      globalThis.fetch = fetchMock;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should fetch remote data with GET', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { label: 'Item 1', value: 'v1' },
          { label: 'Item 2', value: 'v2' },
        ],
      });

      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'remote',
            url: 'https://api.example.com/items',
            method: 'GET',
          },
        },
        formData: {},
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/items',
        expect.objectContaining({ method: 'GET' })
      );
      expect(result.options).toHaveLength(2);
      expect(result.options[0]).toEqual({ label: 'Item 1', value: 'v1' });
    });

    it('should replace URL placeholders', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'remote',
            url: 'https://api.example.com/{{orgId}}/users',
            method: 'GET',
          },
        },
        formData: { orgId: 'org-123' },
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/org-123/users',
        expect.anything()
      );
    });

    it('should replace param placeholders and add search keyword', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'remote',
            url: 'https://api.example.com/search',
            method: 'GET',
            params: {
              dept: '{{deptId}}',
              fixed: 'value',
            },
          },
        },
        formData: { deptId: 'D001' },
        searchKeyword: 'test',
      });

      const calledUrl = fetchMock.mock.calls[0][0];
      expect(calledUrl).toContain('dept=D001');
      expect(calledUrl).toContain('fixed=value');
      expect(calledUrl).toContain('keyword=test');
    });

    it('should extract data using path', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            list: [
              { label: 'A', value: 'a' },
            ],
          },
        }),
      });

      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'remote',
            url: 'https://api.example.com/items',
            path: 'data.list',
          },
        },
        formData: {},
      });

      expect(result.options).toHaveLength(1);
      expect(result.options[0].label).toBe('A');
    });

    it('should send POST request with body', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ name: 'Post Item', id: 'p1' }],
      });

      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'remote',
            url: 'https://api.example.com/items',
            method: 'POST',
            params: { category: 'all' },
          },
        },
        formData: {},
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/items',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ category: 'all' }),
        })
      );
      expect(result.options[0].label).toBe('Post Item');
      expect(result.options[0].value).toBe('p1');
    });

    it('should return empty options on fetch error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'remote',
            url: 'https://api.example.com/items',
          },
        },
        formData: {},
      });

      expect(result.options).toHaveLength(0);
    });

    it('should return empty options on non-ok response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'remote',
            url: 'https://api.example.com/items',
          },
        },
        formData: {},
      });

      expect(result.options).toHaveLength(0);
    });

    it('should return empty options when response is not an array', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ notAnArray: true }),
      });

      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'remote',
            url: 'https://api.example.com/items',
          },
        },
        formData: {},
      });

      expect(result.options).toHaveLength(0);
    });

    it('should return empty options when url is missing', async () => {
      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'remote',
            url: '',
          },
        },
        formData: {},
      });

      expect(result.options).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should fallback label to name, title, or value string', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { name: 'Name Item', value: 'v1' },
          { title: 'Title Item', id: 'v2' },
          { id: 'v3' },
          { key: 'v4' },
        ],
      });

      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'remote',
            url: 'https://api.example.com/items',
          },
        },
        formData: {},
      });

      expect(result.options[0].label).toBe('Name Item');
      expect(result.options[1].label).toBe('Title Item');
      expect(result.options[2].label).toBe('v3');
      expect(result.options[3].label).toBe('v4');
    });
  });

  describe('edge cases', () => {
    it('should return empty options when no dataSource is configured', async () => {
      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
        },
        formData: {},
      });
      expect(result.options).toHaveLength(0);
    });

    it('should return empty options for unknown data source type', async () => {
      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'unknown' as any,
          },
        },
        formData: {},
      });
      expect(result.options).toHaveLength(0);
    });

    it('should return empty options for database type (phase 15)', async () => {
      const result = await resolveDataSource({
        fieldSchema: {
          type: 'string',
          title: 'Test',
          'x-dataSource': {
            type: 'database',
          },
        },
        formData: {},
      });
      expect(result.options).toHaveLength(0);
    });
  });
});
