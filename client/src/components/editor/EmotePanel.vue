<!--
  EmotePanel.vue
  Stickers / Emotes picker (7TV · BetterTTV · FrankerFaceZ · GIFS.RU).
  7TV browse mirrors https://7tv.app/emotes/ — Popular / Trending / New + time filter.
  GIFS.RU: Home / Communities, GIFs or Stickers, same click-to-scene path.
  RMB → Add to / remove from local My Emotes (Recently added section).
-->
<template>
  <div class="emote-panel" v-if="open">
    <div class="fluent-panel-head">
      <span class="fluent-panel-title">
        <Smile class="h-4 w-4" />
        {{ t('panel.stickers') }}
      </span>
      <span class="spacer"></span>
      <Button variant="ghost" size="icon" class="h-7 w-7" :title="t('common.close')" @click="$emit('close')">
        <X class="h-4 w-4" />
      </Button>
    </div>

    <div class="ep-tabs fluent-tabs">
      <button :class="{ active: mode === 'browse' }" @click="mode = 'browse'">{{ t('emotes.tab.browse') }}</button>
      <button :class="{ active: mode === 'cached' }" @click="mode = 'cached'">{{ t('emotes.tab.cached') }}</button>
      <button :class="{ active: mode === 'id' }" @click="mode = 'id'">{{ t('emotes.tab.byId') }}</button>
    </div>

    <Transition name="tab-fade" mode="out-in">
    <div :key="mode" class="ep-tab-pane">
    <div v-if="mode !== 'cached'" class="ep-provs">
      <button
        v-for="key in PROVIDER_KEYS"
        :key="key"
        :class="{ active: provider === key, dim: provider !== key }"
        :style="provider === key ? { borderColor: PROVIDERS[key].color, color: PROVIDERS[key].color } : null"
        :title="PROVIDERS[key].label"
        @click="provider = key"
      >{{ PROVIDERS[key].label }}</button>
    </div>

    <div v-if="mode === 'browse' && provider === '7tv'" class="ep-account">
      <template v-if="!sevenConnected">
        <div class="ep-acct-row">
          <input
            v-model="sevenTokenInput"
            class="ep-acct-input"
            type="password"
            :placeholder="t('emotes.seven.tokenPlaceholder')"
            @keydown.enter="connect7tv"
          />
          <Button size="sm" :disabled="!sevenTokenInput.trim() || sevenLoading" @click="connect7tv">
            {{ t('emotes.seven.connect') }}
          </Button>
        </div>
        <div v-if="sevenError" class="ep-error small">{{ sevenError }}</div>
        <p class="ep-hint muted small">{{ t('emotes.seven.hint') }}</p>
      </template>
      <template v-else>
        <div class="ep-acct-row">
          <span class="ep-acct-ok"><Check class="inline h-3.5 w-3.5" /> {{ sevenUsername }}</span>
          <Button size="sm" variant="secondary" @click="disconnect7tv">{{ t('emotes.seven.disconnect') }}</Button>
        </div>
      </template>
    </div>

    <!-- BROWSE -->
    <div v-if="mode === 'browse'" class="ep-body">
      <!-- 7TV catalogs from 7tv.app/emotes -->
      <div v-if="provider === '7tv'" class="ep-catalogs">
        <button
          v-for="c in sevenCatalogs"
          :key="c.id"
          :class="{ active: browseSource === c.id }"
          @click="setBrowseSource(c.id)"
        >{{ t(c.labelKey) }}</button>
      </div>

      <div v-if="provider === '7tv' && browseSource === 'trending'" class="ep-period">
        <span class="muted small">{{ t('emotes.filter') }}</span>
        <button
          v-for="p in trendPeriods"
          :key="p.id"
          :class="{ active: trendPeriod === p.id }"
          @click="setTrendPeriod(p.id)"
        >{{ t(p.labelKey) }}</button>
      </div>

      <div v-if="provider === 'gifsru'" class="ep-catalogs ep-gifsru">
        <button :class="{ active: gifsKind === 'gif' }" @click="setGifsKind('gif')">{{ t('emotes.gifsru.gif') }}</button>
        <button :class="{ active: gifsKind === 'sticker' }" @click="setGifsKind('sticker')">{{ t('emotes.gifsru.sticker') }}</button>
      </div>
      <div v-if="provider === 'gifsru'" class="ep-catalogs ep-gifsru">
        <button :class="{ active: gifsSource === 'home' }" @click="setGifsSource('home')">{{ t('emotes.gifsru.home') }}</button>
        <button :class="{ active: gifsSource === 'communities' }" @click="setGifsSource('communities')">{{ t('emotes.gifsru.communities') }}</button>
      </div>
      <div
        v-if="provider === 'gifsru' && gifsSource === 'communities'"
        class="ep-communities-wrap"
        @wheel="onCommunitiesWheel"
      >
        <div class="ep-catalogs ep-communities ep-gifsru">
          <button
            v-for="c in gifsCommunities"
            :key="c.id"
            :class="{ active: gifsCommunityId === c.id }"
            @click="setGifsCommunity(c.id)"
          >{{ c.title }}</button>
          <span v-if="!gifsCommunities.length && !gifsCommunitiesLoading" class="muted small">{{ t('emotes.gifsru.communitiesEmpty') }}</span>
        </div>
      </div>

      <input
        v-model="query"
        class="ep-search"
        :placeholder="t('emotes.searchPlaceholder', { provider: PROVIDERS[provider].label })"
        @input="onSearch"
      />
      <div v-if="searchError" class="ep-error">
        {{ offlineHint ? t('emotes.offlineHint') : searchError }}
      </div>
      <div v-if="toast" class="ep-toast">{{ toast }}</div>

      <div
        ref="browseScrollEl"
        class="ep-scroll"
        @wheel.passive="onBrowseWheel"
      >
        <div v-if="loading" class="ep-status">{{ t('emotes.loading') }}</div>

        <!-- My Emotes: paginated combined list (local + account) -->
        <template v-else-if="provider === '7tv' && browseSource === 'my' && !query.trim()">
          <div v-if="!myPageItems.length" class="ep-status muted">
            {{ t('emotes.myEmpty') }}
          </div>
          <template v-else>
            <div v-if="myRecent.length && catalogPage === 1" class="ep-section-title">{{ t('emotes.recentlyAdded') }} · {{ myRecent.length }}</div>
            <EmoteGrid :items="myPageItems" :mine-rev="mineRev" @pick="pick" @add-mine="onAddMine" @remove-mine="onRemoveMine" />
          </template>
        </template>

        <template v-else>
          <div v-if="!pageItems.length" class="ep-status muted">
            {{ offlineHint ? t('emotes.offlineHint') : (query ? t('emotes.noMatches') : t('emotes.catalogEmpty')) }}
          </div>
          <EmoteGrid v-else :items="pageItems" :large="provider === 'gifsru'" :mine-rev="mineRev" @pick="pick" @add-mine="onAddMine" @remove-mine="onRemoveMine" />
        </template>
      </div>

      <div v-if="showPager" class="ep-pager">
        <Button size="sm" variant="secondary" class="h-7 gap-1" :disabled="catalogPage <= 1 || loading" @click="goPage(catalogPage - 1)">
          <ChevronLeft class="h-3.5 w-3.5" /> {{ t('emotes.pagePrev') }}
        </Button>
        <span class="ep-page-label muted small">
          {{
            totalPages > 1
              ? t('emotes.pageOf', { page: catalogPage, total: totalPages })
              : t('emotes.pageLabel', { page: catalogPage })
          }}
        </span>
        <Button size="sm" variant="secondary" class="h-7 gap-1" :disabled="!hasMorePages || loading" @click="goPage(catalogPage + 1)">
          {{ t('emotes.pageNext') }} <ChevronRight class="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>

    <!-- CACHED -->
    <div v-else-if="mode === 'cached'" class="ep-body">
      <p class="ep-hint muted small">{{ t('emotes.cachedHint') }}</p>
      <input v-model="cachedQuery" class="ep-search" :placeholder="t('emotes.cachedSearch')" />
      <div class="ep-scroll">
        <div v-if="cachedError" class="ep-error">{{ cachedError }}</div>
        <div v-if="cachedLoading" class="ep-status">{{ t('emotes.loading') }}</div>
        <div v-else-if="!filteredCached.length" class="ep-status muted">{{ t('emotes.cachedEmpty') }}</div>
        <EmoteGrid v-else :items="filteredCached" :mine-rev="mineRev" @pick="pick" @add-mine="onAddMine" @remove-mine="onRemoveMine" />
        <small v-if="cachedStats" class="muted small">
          {{ t('emotes.cachedStats', { files: cachedStats.files, mb: (cachedStats.bytes / (1024 * 1024)).toFixed(1) }) }}
        </small>
      </div>
    </div>

    <!-- BY URL / ID -->
    <div v-else class="ep-body">
      <div class="ep-scroll">
        <p class="ep-hint muted small">
          {{ t('emotes.byIdHint', { provider: PROVIDERS[provider].label }) }}
        </p>
        <input
          v-model="idInput"
          class="ep-search"
          :placeholder="t('emotes.byIdPlaceholder')"
          @keydown.enter="addFromId"
        />
        <div class="ep-idopts">
          <label v-if="provider !== '7tv'">
            <input type="checkbox" v-model="idStatic" />
            <span>{{ t('emotes.static') }}</span>
          </label>
          <label v-if="provider === 'ffz'">
            <input type="checkbox" v-model="idAnimated" />
            <span>{{ t('emotes.animatedVariant') }}</span>
          </label>
        </div>
        <Button size="sm" class="ep-add" :disabled="!idInput.trim()" @click="addFromId">
          {{ t('emotes.addToScene') }}
        </Button>
        <div v-if="idError" class="ep-error">{{ idError }}</div>
      </div>
    </div>
    </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, watch, computed, defineComponent, h, nextTick } from 'vue'
import { Smile, X, Check, ChevronLeft, ChevronRight } from '@lucide/vue'
import {
  PROVIDERS, PROVIDER_KEYS, searchEmotes, globalEmotes, myEmotes, catalogEmotes,
  gifsruPopular, gifsruCommunities, gifsruCommunity, gifsruSearch,
  buildCdnUrl, addEmote, sevenLogin, sevenAccount, sevenLogout,
  listCachedEmotes, proxiedEmoteUrl,
  listMyEmotes, addToMyEmotes, removeFromMyEmotes, isInMyEmotes, splitMyEmotes
} from '../../features/emotes.js'
import { Button } from '@/components/ui/button'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator
} from '@/components/ui/context-menu'
import { useI18n } from '@/i18n'

const { t } = useI18n()

const EmoteGrid = defineComponent({
  name: 'EmoteGrid',
  props: {
    items: { type: Array, default: () => [] },
    mineRev: { type: Number, default: 0 },
    large: { type: Boolean, default: false }
  },
  emits: ['pick', 'add-mine', 'remove-mine'],
  setup(props, { emit }) {
    return () => h(
      'div',
      { class: ['ep-grid', 'list-stagger', props.large ? 'ep-grid-lg' : ''] },
      props.items.map((e) => {
        void props.mineRev
        const mine = isInMyEmotes(e)
        return h(ContextMenu, { key: (e.provider || '') + ':' + (e.id || e.src || e.url) + ':' + props.mineRev }, {
          default: () => [
            h(ContextMenuTrigger, { asChild: true }, {
              default: () => h(
                'button',
                {
                  class: 'ep-cell',
                  title: (e.name || '') + (e.animated ? ' (animated)' : ''),
                  type: 'button',
                  onClick: () => emit('pick', e)
                },
                [h('img', { src: proxiedEmoteUrl(e.thumb || e.url || e.src), alt: e.name || '', loading: 'lazy', draggable: false })]
              )
            }),
            h(ContextMenuContent, null, {
              default: () => [
                h(ContextMenuItem, { onSelect: () => emit('pick', e) }, {
                  default: () => t('emotes.addToScene')
                }),
                h(ContextMenuSeparator),
                mine
                  ? h(ContextMenuItem, { onSelect: () => emit('remove-mine', e) }, {
                      default: () => t('emotes.removeFromMine')
                    })
                  : h(ContextMenuItem, { onSelect: () => emit('add-mine', e) }, {
                      default: () => t('emotes.addToMine')
                    })
              ]
            })
          ]
        })
      })
    )
  }
})

const props = defineProps({ open: { type: Boolean, default: false } })
defineEmits(['close'])

const mode = ref('browse')
const provider = ref('7tv')
const query = ref('')
const results = ref([])
const loading = ref(false)
const searchError = ref('')
const offlineHint = ref(false)
const toast = ref('')
let toastTimer = null

const cachedList = ref([])
const cachedLoading = ref(false)
const cachedError = ref('')
const cachedQuery = ref('')
const cachedStats = ref(null)

const idInput = ref('')
const idStatic = ref(false)
const idAnimated = ref(false)
const idError = ref('')

const sevenConnected = ref(false)
const sevenUsername = ref('')
const sevenTokenInput = ref('')
const sevenLoading = ref(false)
const sevenError = ref('')

const browseSource = ref('popular') // popular | trending | new | global | my
const trendPeriod = ref('day') // day | week | month
const gifsKind = ref('gif') // gif | sticker
const gifsSource = ref('home') // home | communities
const gifsCommunities = ref([])
const gifsCommunityId = ref(null)
const gifsCommunitiesLoading = ref(false)
let gifsCommunitiesPromise = null
const myLocal = ref(listMyEmotes())
const mineRev = ref(0)
const accountMy = ref([])

/** Catalog / local list paging */
const pageSize = computed(() => provider.value === 'gifsru' ? 24 : 96)
const catalogPage = ref(1)
const catalogHasMore = ref(false)
const catalogTotalCount = ref(null)
const fullPool = ref([]) // client-side pools: global / my / search overflow
const browseScrollEl = ref(null)
const remotePaged = ref(false) // true when popular/trending/new use API pages
let wheelPageCooldown = 0

const sevenCatalogs = [
  { id: 'popular', labelKey: 'emotes.catalog.popular' },
  { id: 'trending', labelKey: 'emotes.catalog.trending' },
  { id: 'new', labelKey: 'emotes.catalog.new' },
  { id: 'global', labelKey: 'emotes.global' },
  { id: 'my', labelKey: 'emotes.my' }
]

const trendPeriods = [
  { id: 'day', labelKey: 'emotes.period.day' },
  { id: 'week', labelKey: 'emotes.period.week' },
  { id: 'month', labelKey: 'emotes.period.month' }
]

let searchTimer = null

const filteredCached = computed(() => {
  const q = cachedQuery.value.trim().toLowerCase()
  if (!q) return cachedList.value
  return cachedList.value.filter((e) =>
    String(e.name || '').toLowerCase().includes(q) ||
    String(e.provider || '').toLowerCase().includes(q) ||
    String(e.id || '').toLowerCase().includes(q)
  )
})

const mySplit = computed(() => splitMyEmotes(myLocal.value))
const myRecent = computed(() => mySplit.value.recent)
const myOlder = computed(() => mySplit.value.older)

/** Local + account emotes, newest local first, then account (deduped). */
const myCombined = computed(() => {
  const seen = new Set()
  const out = []
  const push = (e) => {
    const k = `${e.provider || '7tv'}:${e.id || e.url}`
    if (!e || (!e.url && !e.id) || seen.has(k)) return
    seen.add(k)
    out.push(e)
  }
  for (const e of myLocal.value) push(e)
  for (const e of accountMy.value) push(e)
  return out
})

const myPageItems = computed(() => {
  const start = (catalogPage.value - 1) * pageSize.value
  return myCombined.value.slice(start, start + pageSize.value)
})

const pageItems = computed(() => {
  if (remotePaged.value) return results.value
  const start = (catalogPage.value - 1) * pageSize.value
  return fullPool.value.slice(start, start + pageSize.value)
})

const totalPages = computed(() => {
  if (remotePaged.value) {
    if (catalogTotalCount.value != null) return Math.max(1, Math.ceil(catalogTotalCount.value / pageSize.value))
    return catalogPage.value + (catalogHasMore.value ? 1 : 0)
  }
  const n = provider.value === '7tv' && browseSource.value === 'my' && !query.value.trim()
    ? myCombined.value.length
    : fullPool.value.length
  return Math.max(1, Math.ceil(n / pageSize.value) || 1)
})

const hasMorePages = computed(() => {
  if (remotePaged.value) return catalogHasMore.value
  return catalogPage.value < totalPages.value
})

const showPager = computed(() => {
  if (loading.value) return false
  if (provider.value === 'gifsru') {
    return catalogPage.value > 1 || catalogHasMore.value || (catalogTotalCount.value || 0) > pageSize.value || (remotePaged.value && results.value.length >= pageSize.value)
  }
  if (query.value.trim()) return fullPool.value.length > pageSize.value
  if (provider.value !== '7tv') return fullPool.value.length > pageSize.value
  if (browseSource.value === 'my') return myCombined.value.length > pageSize.value
  if (remotePaged.value) return catalogPage.value > 1 || catalogHasMore.value || (catalogTotalCount.value || 0) > pageSize.value
  return fullPool.value.length > pageSize.value
})

function refreshMyLocal() {
  myLocal.value = listMyEmotes()
  mineRev.value++
}

function showToast(msg) {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 2200)
}

function catalogCategory() {
  if (browseSource.value === 'popular') return 'TOP'
  if (browseSource.value === 'new') return 'NEW'
  if (browseSource.value === 'trending') {
    if (trendPeriod.value === 'week') return 'TRENDING_WEEK'
    if (trendPeriod.value === 'month') return 'TRENDING_MONTH'
    return 'TRENDING_DAY'
  }
  return 'TOP'
}

function resetPager() {
  catalogPage.value = 1
  catalogHasMore.value = false
  catalogTotalCount.value = null
  fullPool.value = []
  remotePaged.value = false
}

function scrollBrowseTop() {
  nextTick(() => {
    const el = browseScrollEl.value
    if (el) el.scrollTop = 0
  })
}

/** Wheel scrolls the grid; at edges (or when nothing to scroll) flips catalog pages. */
function onBrowseWheel(e) {
  if (loading.value) return
  if (!showPager.value && !(hasMorePages.value || catalogPage.value > 1)) return
  const el = browseScrollEl.value
  if (!el) return
  const now = Date.now()
  const canScroll = el.scrollHeight > el.clientHeight + 2
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4
  const atTop = el.scrollTop <= 4
  const wantNext = e.deltaY > 8
  const wantPrev = e.deltaY < -8
  if (canScroll) {
    if (wantNext && atBottom && hasMorePages.value) {
      if (now - wheelPageCooldown < 320) return
      wheelPageCooldown = now
      goPage(catalogPage.value + 1)
    } else if (wantPrev && atTop && catalogPage.value > 1) {
      if (now - wheelPageCooldown < 320) return
      wheelPageCooldown = now
      goPage(catalogPage.value - 1)
    }
    return
  }
  // Grid fits in view — wheel turns pages so more emotes are reachable.
  if (wantNext && hasMorePages.value) {
    if (now - wheelPageCooldown < 320) return
    wheelPageCooldown = now
    goPage(catalogPage.value + 1)
  } else if (wantPrev && catalogPage.value > 1) {
    if (now - wheelPageCooldown < 320) return
    wheelPageCooldown = now
    goPage(catalogPage.value - 1)
  }
}

function setBrowseSource(id) {
  browseSource.value = id
  query.value = ''
  resetPager()
  runSearch()
}

function setTrendPeriod(id) {
  trendPeriod.value = id
  if (!query.value) {
    resetPager()
    runSearch()
  }
}

function setGifsKind(kind) {
  if (gifsKind.value === kind) return
  gifsKind.value = kind
  resetPager()
  runSearch()
}

function setGifsSource(id) {
  if (gifsSource.value === id) return
  gifsSource.value = id
  resetPager()
  if (id === 'communities') ensureGifsCommunities().then(() => runSearch())
  else runSearch()
}

function setGifsCommunity(id) {
  if (gifsCommunityId.value === id) return
  gifsCommunityId.value = id
  resetPager()
  runSearch()
}

async function ensureGifsCommunities() {
  if (gifsCommunities.value.length) {
    if (gifsCommunityId.value == null) gifsCommunityId.value = gifsCommunities.value[0].id
    return
  }
  if (gifsCommunitiesPromise) {
    await gifsCommunitiesPromise
    if (gifsCommunityId.value == null && gifsCommunities.value.length) {
      gifsCommunityId.value = gifsCommunities.value[0].id
    }
    return
  }
  gifsCommunitiesLoading.value = true
  gifsCommunitiesPromise = gifsruCommunities()
    .then((list) => {
      gifsCommunities.value = list
      if (gifsCommunityId.value == null && list.length) gifsCommunityId.value = list[0].id
    })
    .catch(() => {
      gifsCommunities.value = []
    })
    .finally(() => {
      gifsCommunitiesLoading.value = false
      gifsCommunitiesPromise = null
    })
  await gifsCommunitiesPromise
}

function onCommunitiesWheel(e) {
  const wrap = e.currentTarget
  const el = wrap?.querySelector?.('.ep-communities') || wrap
  if (!el || el.scrollWidth <= el.clientWidth + 2) return
  const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX
  if (!delta) return
  e.preventDefault()
  e.stopPropagation()
  el.scrollLeft += delta
}

function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    resetPager()
    runSearch()
  }, 200)
}

async function goPage(p) {
  const next = Math.max(1, p)
  if (next === catalogPage.value) return
  catalogPage.value = next
  scrollBrowseTop()
  if (remotePaged.value) {
    await runSearch({ keepPage: true })
  }
}

async function runSearch(opts = {}) {
  const cfg = PROVIDERS[provider.value]
  if (!cfg.search) { results.value = []; return }
  if (!opts.keepPage) {
    // keepPage used when flipping remote API pages
  } else {
    // page already set by goPage
  }
  loading.value = true
  searchError.value = ''
  offlineHint.value = false
  if (!opts.keepPage) accountMy.value = []
  try {
    const q = query.value.trim()
    if (provider.value === 'gifsru') {
      remotePaged.value = true
      const page = opts.keepPage ? catalogPage.value : 1
      if (!opts.keepPage) catalogPage.value = 1
      let data
      if (q) {
        data = await gifsruSearch(q, gifsKind.value, page, pageSize.value)
      } else if (gifsSource.value === 'communities') {
        await ensureGifsCommunities()
        if (gifsCommunityId.value == null) {
          results.value = []
          fullPool.value = []
          catalogHasMore.value = false
          catalogTotalCount.value = 0
          searchError.value = t('emotes.gifsru.pickCommunity')
          return
        }
        data = await gifsruCommunity(gifsCommunityId.value, gifsKind.value, page, pageSize.value)
      } else {
        data = await gifsruPopular(gifsKind.value, page, pageSize.value)
      }
      results.value = data.results || []
      fullPool.value = results.value
      catalogHasMore.value = !!data.hasMore
      catalogTotalCount.value = data.count
      return
    }

    if (q) {
      remotePaged.value = false
      const list = await searchEmotes(provider.value, q, pageSize.value)
      fullPool.value = list
      results.value = list
      catalogHasMore.value = false
      catalogTotalCount.value = list.length
      return
    }

    if (provider.value === '7tv') {
      if (browseSource.value === 'my') {
        remotePaged.value = false
        refreshMyLocal()
        if (sevenConnected.value) {
          try {
            const data = await myEmotes('7tv')
            accountMy.value = data.results || []
            if (!data.connected) { sevenConnected.value = false; sevenUsername.value = '' }
          } catch (_) {
            accountMy.value = []
          }
        }
        results.value = []
        fullPool.value = myCombined.value
        catalogTotalCount.value = myCombined.value.length
        catalogHasMore.value = catalogPage.value * pageSize.value < myCombined.value.length
        return
      }
      if (browseSource.value === 'global') {
        remotePaged.value = false
        const list = await globalEmotes('7tv')
        fullPool.value = list
        results.value = list
        catalogTotalCount.value = list.length
        catalogHasMore.value = catalogPage.value * pageSize.value < list.length
        return
      }
      // Popular / Trending / New — server pages
      remotePaged.value = true
      const page = opts.keepPage ? catalogPage.value : 1
      if (!opts.keepPage) catalogPage.value = 1
      const data = await catalogEmotes(catalogCategory(), pageSize.value, page)
      results.value = data.results || []
      fullPool.value = results.value
      catalogHasMore.value = !!data.hasMore
      catalogTotalCount.value = data.count
      return
    }

    remotePaged.value = false
    if (cfg.global) {
      const list = await globalEmotes(provider.value)
      fullPool.value = list
      results.value = list
      catalogTotalCount.value = list.length
      catalogHasMore.value = catalogPage.value * pageSize.value < list.length
    } else {
      results.value = []
      fullPool.value = []
    }
  } catch (err) {
    results.value = []
    fullPool.value = []
    searchError.value = err.message
    offlineHint.value = typeof navigator !== 'undefined' && navigator.onLine === false
  } finally {
    loading.value = false
  }
}

async function loadCached() {
  cachedLoading.value = true
  cachedError.value = ''
  try {
    const data = await listCachedEmotes()
    cachedList.value = (data.results || []).map((e) => ({
      ...e,
      url: e.src || e.url,
      id: e.id || e.src
    }))
    cachedStats.value = data.stats || null
  } catch (err) {
    cachedList.value = []
    cachedError.value = err.message
  } finally {
    cachedLoading.value = false
  }
}

watch(provider, () => {
  query.value = ''
  results.value = []
  searchError.value = ''
  resetPager()
  if (provider.value === '7tv' && !['popular', 'trending', 'new', 'global', 'my'].includes(browseSource.value)) {
    browseSource.value = 'popular'
  }
  if (provider.value === 'gifsru') ensureGifsCommunities()
  if (mode.value === 'browse') runSearch()
})

watch(() => [mode.value, provider.value], () => {
  if (mode.value === 'browse' && !results.value.length) runSearch()
  if (mode.value === 'cached') loadCached()
}, { immediate: true })

watch(() => props.open, (isOpen) => {
  if (isOpen && provider.value === '7tv') probe7tv()
  if (isOpen && mode.value === 'cached') loadCached()
  if (isOpen) refreshMyLocal()
})

watch(provider, () => {
  if (provider.value === '7tv' && props.open) probe7tv()
})

async function probe7tv() {
  try {
    const data = await sevenAccount()
    sevenConnected.value = !!data.connected
    sevenUsername.value = data.username || ''
  } catch (_) {
    sevenConnected.value = false
    sevenUsername.value = ''
  }
}

async function connect7tv() {
  sevenError.value = ''
  sevenLoading.value = true
  try {
    const data = await sevenLogin(sevenTokenInput.value.trim())
    sevenConnected.value = true
    sevenUsername.value = data.username
    sevenTokenInput.value = ''
    if (browseSource.value === 'my') runSearch()
  } catch (err) {
    sevenError.value = err.message
  } finally {
    sevenLoading.value = false
  }
}

async function disconnect7tv() {
  try { await sevenLogout() } catch (_) { /* best effort */ }
  sevenConnected.value = false
  sevenUsername.value = ''
  accountMy.value = []
}

function onAddMine(e) {
  addToMyEmotes(e)
  refreshMyLocal()
  showToast(t('emotes.addedToMine'))
}

function onRemoveMine(e) {
  removeFromMyEmotes(e)
  refreshMyLocal()
  showToast(t('emotes.removedFromMine'))
}

function pick(e) {
  addEmote(e)
    .then((r) => {
      if (r?.warn) searchError.value = r.warn
      if (mode.value === 'cached') loadCached()
    })
    .catch((err) => {
      if (mode.value === 'cached') cachedError.value = err.message
      else searchError.value = err.message
    })
}

function addFromId() {
  idError.value = ''
  const built = buildCdnUrl(provider.value, idInput.value, {
    static: idStatic.value,
    animated: idAnimated.value
  })
  if (!built) { idError.value = t('emotes.enterId'); return }
  addEmote({ ...built, name: built.emoteId || 'Emote' })
    .then((r) => {
      idInput.value = ''
      if (r?.warn) idError.value = r.warn
    })
    .catch((err) => { idError.value = err.message })
}
</script>

<style scoped>
.emote-panel {
  position: fixed;
  top: 44px;
  right: 12px;
  width: min(520px, calc(100vw - 24px));
  max-height: calc(100vh - 72px);
  height: min(860px, calc(100vh - 72px));
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  z-index: 99;
  overflow: hidden;
}
.ep-tab-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.spacer { flex: 1; }
.ep-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px 0;
}
.ep-tabs button {
  flex: 1;
  padding: 5px 6px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
}
.ep-tabs button.active {
  background: var(--panel);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}
.ep-provs {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.ep-provs button {
  padding: 4px 10px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
}
.ep-provs button.dim { color: var(--text-dim); }

.ep-account {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ep-acct-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.ep-acct-input {
  flex: 1;
  font-size: 11px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
}
.ep-acct-ok {
  flex: 1;
  font-size: 12px;
  color: #22d3ee;
  font-weight: 500;
}

.ep-catalogs, .ep-period {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.ep-catalogs button, .ep-period button {
  padding: 3px 9px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text-dim);
  cursor: pointer;
}
.ep-catalogs button.active, .ep-period button.active {
  border-color: #22d3ee;
  color: #22d3ee;
  font-weight: 600;
}
.ep-communities-wrap {
  min-width: 0;
  width: 100%;
  max-width: 100%;
  position: relative;
  overflow: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.ep-communities-wrap::before,
.ep-communities-wrap::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 18px;
  pointer-events: none;
  z-index: 1;
  opacity: 0;
  transition: opacity 0.12s;
}
.ep-communities-wrap::before {
  left: 0;
  background: linear-gradient(90deg, var(--panel), transparent);
}
.ep-communities-wrap::after {
  right: 0;
  background: linear-gradient(270deg, var(--panel), transparent);
}
.ep-communities-wrap:hover::before,
.ep-communities-wrap:hover::after { opacity: 1; }
.ep-communities {
  flex-wrap: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.ep-communities::-webkit-scrollbar,
.ep-communities-wrap::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}
.ep-communities button { white-space: nowrap; flex-shrink: 0; }
.ep-gifsru button.active {
  border-color: #f97316;
  color: #f97316;
}

.ep-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  min-height: 0;
  overflow: hidden;
}
.ep-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.ep-scroll::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}
.ep-pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-top: 1px solid var(--border);
  padding-top: 8px;
  flex-shrink: 0;
  background: var(--panel);
}
.ep-page-label {
  flex: 1;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.ep-search {
  width: 100%;
  font-size: 12px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
}
.ep-status { font-size: 12px; color: var(--text-dim); padding: 8px 0; }
.ep-error { font-size: 12px; color: var(--danger); }
.ep-toast {
  font-size: 11px;
  color: var(--ok, #3dd68c);
  padding: 2px 0;
}
.ep-section { display: flex; flex-direction: column; gap: 6px; }
.ep-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding-top: 4px;
}
:deep(.ep-grid) {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
  gap: 6px;
}
:deep(.ep-grid-lg) {
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 8px;
}
:deep(.ep-grid-lg .ep-cell) {
  padding: 6px;
  border-radius: 8px;
}
:deep(.ep-cell) {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
:deep(.ep-cell:hover) {
  background: var(--hover);
  border-color: var(--accent);
}
:deep(.ep-cell img) {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  pointer-events: none;
}
.ep-hint { margin: 0; line-height: 1.35; }
.ep-idopts {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--text-dim);
}
.ep-idopts label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.ep-add { align-self: flex-start; }
.small { font-size: 11px; }
</style>
