const SEVEN_GQL = 'https://7tv.io/v3/gql'

async function gql(query, variables = {}) {
  const r = await fetch(SEVEN_GQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  })
  const j = await r.json()
  return { status: r.status, j }
}

// Probe introspection-ish by trying website-like queries
const queries = [
  {
    name: 'sort_value_order',
    query: `query($q:String!,$page:Int,$limit:Int,$sort:Sort){
      emotes(query:$q,page:$page,limit:$limit,sort:$sort){
        count items { id name animated host { url files { name format width } } }
      }
    }`,
    variables: { q: '', page: 1, limit: 5, sort: { value: 'popularity', order: 'DESCENDING' } }
  },
  {
    name: 'sort_channel_count',
    query: `query($q:String!,$page:Int,$limit:Int,$sort:Sort){
      emotes(query:$q,page:$page,limit:$limit,sort:$sort){
        count items { id name }
      }
    }`,
    variables: { q: '', page: 1, limit: 5, sort: { value: 'channel_count', order: 'DESCENDING' } }
  },
  {
    name: 'sort_created_at',
    query: `query($q:String!,$page:Int,$limit:Int,$sort:Sort){
      emotes(query:$q,page:$page,limit:$limit,sort:$sort){
        count items { id name created_at }
      }
    }`,
    variables: { q: '', page: 1, limit: 5, sort: { value: 'created_at', order: 'DESCENDING' } }
  },
  {
    name: 'filter_date',
    query: `query($q:String!,$page:Int,$limit:Int,$sort:Sort,$filter:EmoteSearchFilter){
      emotes(query:$q,page:$page,limit:$limit,sort:$sort,filter:$filter){
        count items { id name }
      }
    }`,
    variables: {
      q: '',
      page: 1,
      limit: 5,
      sort: { value: 'popularity', order: 'DESCENDING' },
      filter: { animated: null, exact_match: false }
    }
  }
]

for (const t of queries) {
  const r = await gql(t.query, t.variables)
  const err = r.j?.errors?.[0]?.message || null
  const items = r.j?.data?.emotes?.items?.slice(0, 3)?.map((e) => e.name)
  console.log('\n==', t.name, 'status', r.status)
  console.log('err', err)
  console.log('items', items)
  if (r.j?.errors) console.log(JSON.stringify(r.j.errors[0], null, 2).slice(0, 400))
}
