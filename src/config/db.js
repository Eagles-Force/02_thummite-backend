import pg from 'pg'
import 'dotenv/config'

const { Pool } = pg

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Configure your Neon PostgreSQL connection string.')
}

// Keep SSL policy in one place. pg-connection-string can override an explicit SSL
// object when sslmode is also present in the URL, so remove only that URL parameter
// and apply the configured SSL object below.
const databaseUrl = new URL(process.env.DATABASE_URL)
databaseUrl.searchParams.delete('sslmode')
const useDatabaseSSL = process.env.NODE_ENV === 'production' || process.env.DATABASE_SSL === 'true'

const pool = new Pool({
  connectionString: databaseUrl.toString(),
  ssl: useDatabaseSSL ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true
})

pool.on('error', (error) => console.error('Unexpected PostgreSQL pool error:', error))

export const query = (text, params = []) => pool.query(text, params)
export const getClient = () => pool.connect()
export const closePool = () => pool.end()

const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const quote = (value) => {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`)
  return `"${value}"`
}

let relationshipsPromise
const getRelationships = async () => {
  if (!relationshipsPromise) {
    relationshipsPromise = query(`
      SELECT
        child.relname AS child_table,
        child_col.attname AS child_column,
        parent.relname AS parent_table,
        parent_col.attname AS parent_column,
        con.conname AS constraint_name
      FROM pg_constraint con
      JOIN pg_class child ON child.oid = con.conrelid
      JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
      JOIN pg_class parent ON parent.oid = con.confrelid
      JOIN pg_attribute child_col ON child_col.attrelid = child.oid AND child_col.attnum = con.conkey[1]
      JOIN pg_attribute parent_col ON parent_col.attrelid = parent.oid AND parent_col.attnum = con.confkey[1]
      WHERE con.contype = 'f' AND child_ns.nspname = 'public'
    `).then(({ rows }) => rows)
  }
  return relationshipsPromise
}

const splitTopLevel = (input) => {
  const parts = []
  let depth = 0
  let current = ''
  for (const char of input) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (char === ',' && depth === 0) {
      if (current.trim()) parts.push(current.trim())
      current = ''
    } else current += char
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

const parseSelection = (selection = '*') => splitTopLevel(selection || '*').map((part) => {
  const match = part.match(/^([\w!]+)\s*\(([\s\S]*)\)$/)
  if (match) {
    const [relationSpec, fields] = [match[1], match[2]]
    const [relation, constraint] = relationSpec.split('!')
    return { type: 'relation', relation, constraint: constraint || null, fields: parseSelection(fields) }
  }
  const name = part.trim()
  if (name === '*') return { type: 'all' }
  if (!/^[\w]+$/.test(name)) throw new Error(`Unsupported select expression: ${name}`)
  return { type: 'column', name }
})

const resolveRelationship = (baseTable, relation, constraint, rels) => {
  const candidates = rels.filter((r) =>
    (r.child_table === baseTable && r.parent_table === relation) ||
    (r.parent_table === baseTable && r.child_table === relation)
  ).filter((r) => !constraint || r.constraint_name === constraint)
  if (candidates.length !== 1) throw new Error(`Cannot resolve relationship ${baseTable} -> ${relation}${constraint ? ` (${constraint})` : ''}`)
  return candidates[0]
}

const relationJsonSql = async (baseTable, item, baseAlias, rels, suffix) => {
  const rel = resolveRelationship(baseTable, item.relation, item.constraint, rels)
  const relationAlias = `j${suffix}`
  const projection = await jsonProjectionSql(item.relation, item.fields, relationAlias, rels, `${suffix}_n`)
  if (rel.child_table === baseTable) {
    return `(SELECT ${projection} FROM ${quote(item.relation)} ${relationAlias} WHERE ${relationAlias}.${quote(rel.parent_column)} = ${baseAlias}.${quote(rel.child_column)} LIMIT 1)`
  }
  return `COALESCE((SELECT jsonb_agg(${projection}) FROM ${quote(item.relation)} ${relationAlias} WHERE ${relationAlias}.${quote(rel.child_column)} = ${baseAlias}.${quote(rel.parent_column)}), '[]'::jsonb)`
}

const jsonProjectionSql = async (table, selection, alias, rels, suffix = 'x') => {
  const parsed = Array.isArray(selection) ? selection : parseSelection(selection)
  const hasAll = parsed.some((item) => item.type === 'all')
  const pairs = []
  let relationIndex = 0
  for (const item of parsed) {
    if (item.type === 'column') pairs.push(`'${item.name.replaceAll("'", "''")}', ${alias}.${quote(item.name)}`)
    if (item.type === 'relation') {
      const value = await relationJsonSql(table, item, alias, rels, `${suffix}_${relationIndex++}`)
      pairs.push(`'${item.relation.replaceAll("'", "''")}', ${value}`)
    }
  }
  if (hasAll) return pairs.length ? `(to_jsonb(${alias}) || jsonb_build_object(${pairs.join(', ')}))` : `to_jsonb(${alias})`
  return `jsonb_build_object(${pairs.join(', ')})`
}

const selectionSql = async (baseTable, selection, baseAlias = 'b', relationships = null) => {
  const rels = relationships || await getRelationships()
  const parsed = Array.isArray(selection) ? selection : parseSelection(selection)
  const fields = []
  let relationIndex = 0
  for (const item of parsed) {
    if (item.type === 'all') fields.push(`${baseAlias}.*`)
    else if (item.type === 'column') fields.push(`${baseAlias}.${quote(item.name)}`)
    else if (item.type === 'relation') {
      const value = await relationJsonSql(baseTable, item, baseAlias, rels, `root_${relationIndex++}`)
      fields.push(`${value} AS ${quote(item.relation)}`)
    }
  }
  return fields.join(', ')
}

class QueryBuilder {
  constructor(table) {
    if (!IDENTIFIER.test(table)) throw new Error('Invalid table name')
    this.table = table
    this.action = 'select'
    this.selection = '*'
    this.values = null
    this.filters = []
    this.orders = []
    this.offset = null
    this.limitValue = null
    this.singleMode = false
    this.maybeSingleMode = false
    this.countMode = null
    this.head = false
    this.returning = false
  }
  select(selection = '*', options = {}) {
    this.selection = selection || '*'
    if (this.action !== 'select') this.returning = true
    this.countMode = options.count || this.countMode
    this.head = options.head || false
    return this
  }
  insert(values) { this.action = 'insert'; this.values = Array.isArray(values) ? values : [values]; return this }
  update(values) { this.action = 'update'; this.values = values; return this }
  delete() { this.action = 'delete'; return this }
  eq(column, value) { return value === null ? this.#where(column, 'IS', null) : this.#where(column, '=', value) }
  neq(column, value) { return this.#where(column, '<>', value) }
  gte(column, value) { return this.#where(column, '>=', value) }
  lte(column, value) { return this.#where(column, '<=', value) }
  gt(column, value) { return this.#where(column, '>', value) }
  lt(column, value) { return this.#where(column, '<', value) }
  ilike(column, value) { return this.#where(column, 'ILIKE', value) }
  textSearch(column, search, options = {}) {
    const config = options.config || 'english'
    const type = options.type || 'websearch'
    if (!IDENTIFIER.test(column) || !['english', 'simple'].includes(config) || !['websearch', 'plain', 'phrase', 'raw'].includes(type)) throw new Error('Invalid full-text search configuration')
    this.filters.push({ textSearch: true, column, value: search, searchType: type, config })
    return this
  }
  like(column, value) { return this.#where(column, 'LIKE', value) }
  in(column, values) {
    if (!IDENTIFIER.test(column) || !Array.isArray(values)) throw new Error('Invalid IN filter')
    this.filters.push({ column, operator: 'IN', value: values })
    return this
  }
  is(column, value) { return this.#where(column, value === null ? 'IS' : '=', value) }
  or(expression) {
    const alternatives = expression.split(',').map((part) => {
      const match = part.match(/^([\w]+)\.(eq|neq|gte|lte|gt|lt|ilike|like)\.(.*)$/)
      if (!match) throw new Error(`Unsupported OR filter: ${part}`)
      const [, column, op, value] = match
      return { column, operator: ({ eq: '=', neq: '<>', gte: '>=', lte: '<=', gt: '>', lt: '<', ilike: 'ILIKE', like: 'LIKE' })[op], value }
    })
    this.filters.push({ or: alternatives })
    return this
  }
  order(column, options = {}) { if (!IDENTIFIER.test(column)) throw new Error('Invalid order column'); this.orders.push({ column, ascending: options.ascending !== false }); return this }
  range(from, to) { const start = Math.max(0, Math.floor(Number(from) || 0)); const end = Math.max(start, Math.floor(Number(to) || start)); this.offset = start; this.limitValue = end - start + 1; return this }
  limit(value) { this.limitValue = Math.max(0, Math.floor(Number(value) || 0)); return this }
  single() { this.singleMode = true; return this }
  maybeSingle() { this.maybeSingleMode = true; return this }
  #where(column, operator, value) {
    const parts = String(column).split('.')
    if (parts.length > 2 || parts.some((part) => !IDENTIFIER.test(part))) throw new Error(`Invalid filter column: ${column}`)
    this.filters.push({ column: parts.at(-1), relation: parts.length === 2 ? parts[0] : null, operator, value })
    return this
  }
  async execute() {
    const client = await pool.connect()
    try {
      const params = []
      const addParam = (value) => { params.push(value); return `$${params.length}` }
      const whereParts = []
      const rels = this.filters.some((filter) => filter.relation) ? await getRelationships() : null
      let relationFilterIndex = 0
      for (const filter of this.filters) {
        if (filter.or) {
          whereParts.push(`(${filter.or.map((item) => `${quote(item.column)} ${item.operator} ${addParam(item.value)}`).join(' OR ')})`)
          continue
        }
        if (filter.textSearch) {
          const searchFunction = ({ websearch: 'websearch_to_tsquery', plain: 'plainto_tsquery', phrase: 'phraseto_tsquery', raw: 'to_tsquery' })[filter.searchType]
          whereParts.push(`${quote(filter.column)} @@ ${searchFunction}('${filter.config}', ${addParam(filter.value)})`)
          continue
        }
        if (filter.relation) {
          const relation = resolveRelationship(this.table, filter.relation, null, rels)
          const alias = `f${relationFilterIndex++}`
          const join = relation.child_table === this.table
            ? `${alias}.${quote(relation.parent_column)} = b.${quote(relation.child_column)}`
            : `${alias}.${quote(relation.child_column)} = b.${quote(relation.parent_column)}`
          const comparison = filter.operator === 'IS' && filter.value === null
            ? `${alias}.${quote(filter.column)} IS NULL`
            : `${alias}.${quote(filter.column)} ${filter.operator} ${addParam(filter.value)}`
          whereParts.push(`EXISTS (SELECT 1 FROM ${quote(filter.relation)} ${alias} WHERE ${join} AND ${comparison})`)
          continue
        }
        if (filter.operator === 'IS' && filter.value === null) whereParts.push(`${quote(filter.column)} IS NULL`)
        else if (filter.operator === 'IN') whereParts.push(filter.value.length ? `${quote(filter.column)} = ANY(${addParam(filter.value)})` : 'FALSE')
        else whereParts.push(`${quote(filter.column)} ${filter.operator} ${addParam(filter.value)}`)
      }
      const where = whereParts.length ? ` WHERE ${whereParts.join(' AND ')}` : ''
      let rows = []
      let count = null
      if (this.action === 'select') {
        if (this.countMode === 'exact') {
          const countResult = await client.query(`SELECT COUNT(*)::int AS count FROM ${quote(this.table)} b${where}`, params)
          count = countResult.rows[0]?.count ?? 0
        }
        if (!this.head) {
          const projection = await selectionSql(this.table, this.selection)
          const order = this.orders.length ? ` ORDER BY ${this.orders.map((o) => `${quote(o.column)} ${o.ascending ? 'ASC' : 'DESC'}`).join(', ')}` : ''
          const paging = `${this.limitValue !== null ? ` LIMIT ${Math.max(0, this.limitValue)}` : ''}${this.offset !== null ? ` OFFSET ${Math.max(0, this.offset)}` : ''}`
          const result = await client.query(`SELECT ${projection} FROM ${quote(this.table)} b${where}${order}${paging}`, params)
          rows = result.rows
        }
      } else if (this.action === 'insert') {
        const records = this.values || []
        if (!records.length) throw new Error('Insert requires at least one record')
        const keys = [...new Set(records.flatMap((record) => Object.keys(record)))]; keys.forEach(quote)
        const tuples = records.map((record) => `(${keys.map((key) => addParam(record[key] ?? null)).join(', ')})`)
        let returning = ''
        if (this.returning) returning = ` RETURNING ${await selectionSql(this.table, this.selection, 'b')}`
        const result = await client.query(`INSERT INTO ${quote(this.table)} AS b (${keys.map(quote).join(', ')}) VALUES ${tuples.join(', ')}${returning}`, params)
        rows = result.rows
      } else if (this.action === 'update') {
        if (!this.filters.length) throw new Error('Refusing to update every row without a filter')
        const entries = Object.entries(this.values || {})
        if (!entries.length) throw new Error('Update requires values')
        const assignments = entries.map(([key, value]) => `${quote(key)} = ${addParam(value)}`).join(', ')
        const returning = this.returning ? ` RETURNING ${await selectionSql(this.table, this.selection, 'b')}` : ''
        const result = await client.query(`UPDATE ${quote(this.table)} AS b SET ${assignments}${where}${returning}`, params)
        rows = result.rows
      } else if (this.action === 'delete') {
        if (!this.filters.length) throw new Error('Refusing to delete every row without a filter')
        const returning = this.returning ? ` RETURNING ${await selectionSql(this.table, this.selection, 'b')}` : ''
        const result = await client.query(`DELETE FROM ${quote(this.table)} AS b${where}${returning}`, params)
        rows = result.rows
      }
      let data = this.head ? null : rows
      if (this.singleMode) {
        if (rows.length !== 1) return { data: null, error: { message: `Expected one row, received ${rows.length}` }, count }
        data = rows[0]
      } else if (this.maybeSingleMode) {
        if (rows.length > 1) return { data: null, error: { message: `Expected at most one row, received ${rows.length}` }, count }
        data = rows[0] || null
      }
      return { data, error: null, count }
    } catch (error) {
      return { data: null, error, count: null }
    } finally {
      client.release()
    }
  }
  then(resolve, reject) { return this.execute().then(resolve, reject) }
}

const db = { from: (table) => new QueryBuilder(table) }
export default db
