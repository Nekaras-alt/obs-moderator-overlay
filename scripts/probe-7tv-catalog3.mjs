const SEVEN_GQL = 'https://7tv.io/v3/gql'

async function gql(query, variables = {}) {
  const r = await fetch(SEVEN_GQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  })
  return r.json()
}

const intro = await gql(`{
  cat: __type(name: "EmoteSearchCategory") {
    name enumValues { name description }
  }
  order: __type(name: "SortOrder") {
    enumValues { name }
  }
}`)
console.log(JSON.stringify(intro, null, 2))

const Q = `query($q:String!,$page:Int,$limit:Int,$sort:Sort,$filter:EmoteSearchFilter){
  emotes(query:$q,page:$page,limit:$limit,sort:$sort,filter:$filter){
    count
    items {
      id name animated created_at
      host { url files { name format width } }
    }
  }
}`

const cats = (intro?.data?.cat?.enumValues || []).map((e) => e.name)
console.log('categories', cats)

for (const category of cats) {
  for (const sort of [
    { value: 'popularity', order: 'DESCENDING' },
    { value: 'age_asc', order: 'ASCENDING' },
    { value: 'created_at', order: 'DESCENDING' },
    { value: 'trending_daily', order: 'DESCENDING' },
  ]) {
    const j = await gql(Q, {
      q: '',
      page: 1,
      limit: 6,
      sort,
      filter: { category }
    })
    const items = j?.data?.emotes?.items?.map((e) => e.name) || null
    const err = j?.errors?.[0]?.message
    if (items || (sort.value === 'popularity')) {
      console.log(category, sort.value, '=>', items || err)
    }
  }
}

// Mutations for adding to set?
const mut = await gql(`{
  __schema {
    mutationType {
      fields { name args { name type { name kind ofType { name } } } }
    }
  }
}`)
const fields = mut?.data?.__schema?.mutationType?.fields || []
console.log('mutations', fields.map((f) => f.name).filter((n) => /emote/i.test(n)))
