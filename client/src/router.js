import { createRouter, createWebHistory } from 'vue-router'
import EditorView from './components/editor/EditorView.vue'
import ObsView from './components/obs/ObsView.vue'

// Two routes from one app:
//   /     -> moderator editor (needs PIN)
//   /obs  -> bare renderer for OBS Browser Source (uses viewer token in ?t=)
export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'editor', component: EditorView },
    { path: '/obs', name: 'obs', component: ObsView }
  ]
})
