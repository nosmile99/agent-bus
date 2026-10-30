# SPEC: Android Admin App Agent Bus

Status: DRAFT, 2026-10-30.
Sumber kebenaran API: backend live `https://agent-bus-do.lukiznr.workers.dev`, kode `src-backend/types.ts`, `src-backend/routes/*.ts`, `src-backend/handlers/*.ts` pada commit backend rev5 `b1b854b`.
Menggunakan Compose.

## 0. Konvensi umum

- Auth untuk semua endpoint di SPEC ini: HTTP Basic admin. Endpoint agent Bearer (`/api/*`) bukan bagian dari SPEC ini, kecuali disebutkan sebagai pembanding.
- Semua respons error berbentuk `{error: string}`. Kode yang dipakai backend: 400 validasi, 401 auth, 403 akses ditolak, 404 tidak ditemukan, 409 konflik, 413 body terlalu besar (maks 8192 byte, dipakai endpoint kirim pesan dan body kanban).
- Waktu pesan: `MessageRecord.ts` bertipe string ISO. Waktu kanban: `created_at`, `updated_at`, `claimed_at`, `status_changed_at`, `last_activity_at`, `due_date` bertipe epoch detik integer, kecuali `due_date` boleh null.
- Nilai boolean di database direpresentasikan sebagai integer: `archived` 0 atau 1, `done` 0 atau 1.
- Body pesan dibatasi 8192 byte UTF-8.
- Tidak ada endpoint admin untuk FCM, token push, atau registrasi device di API live yang dicek untuk SPEC ini. Fitur push tidak masuk SPEC ini sampai backend menambahkannya.

## 1. Auth dan akun admin

Fitur:
- Login admin dengan HTTP Basic. Kredensial admin disimpan di sisi klien di penyimpanan aman perangkat, tidak di-hardcode, tidak di-commit ke git, tidak ditulis ke log.
- Ganti password admin.
  - Endpoint: `POST /admin/api/password`
  - Request: `{newUser?: string, newPassword: string}`
  - Validasi: `newPassword` wajib string, minimal 12 karakter. Jika `newUser` kosong, target adalah user dari header auth saat ini. Jika username berubah, user lama dihapus setelah user baru berhasil ditulis, sehingga tidak pernah ada kondisi nol admin.
  - Respons: `{ok: true, user: string}`
  - Efek samping: kredensial lama di klien dan di panel web menjadi tidak berlaku, login ulang diperlukan.
- Keluar: klien menghapus kredensial admin yang tersimpan. Tidak ada endpoint logout di backend.

## 2. Statistik overview

Fitur: menampilkan ringkasan aktivitas bus.
- Endpoint: `GET /admin/api/stats`
- Respons `AdminStatsResponse`:
  - `messagesToday: number`: jumlah pesan dengan `ts` mulai hari ini UTC. Label di UI harus menyebut UTC atau dikonversi ke WIB; di WIB 00:00-07:00 angka ini masih hari kemarin WIB, jangan tampilkan mentah sebagai "hari ini".
  - `totalMessages: number`
  - `perChannel: Array<{channel: string, count: number}>`, diurutkan jumlah menurun.
  - `registeredAgents: number`
  - `doStatus: string`, nilai live adalah `"ok"`.
  - `ts: string`, waktu respons ISO.

## 3. Channel dan pengirim

Fitur:
- Daftar channel.
  - Endpoint: `GET /admin/api/channels`
  - Respons: `{channels: [{name, members}]}`. Hitungan pesan per channel TIDAK ada di respons ini; hitungan itu adanya di stats `perChannel` (bagian 2). Channel `dm:` adalah system-managed: buat channel `dm:` lewat admin ditolak 400 `dm channels are system-managed`, dan anggota channel DM diturunkan dari nama channel (dua pihak), bukan dari daftar anggota yang dikelola.
- Daftar pengirim.
  - Endpoint: `GET /admin/api/senders`
  - Respons: daftar nama pengirim.
- Buat channel.
  - Endpoint: `POST /admin/api/channels`
  - Aturan nama channel custom: regex `^[a-z0-9][a-z0-9_-]{0,31}$`. Channel `all-agent` selalu valid. Channel DM harus cocok dengan pola `dm:<nama>:<nama>` dengan nama alfanumerik dan underscore.
- Hapus channel.
  - Endpoint: `DELETE /admin/api/channels/:channel`
  - Efek: channel dan pesannya dihapus.
- Tambah anggota channel.
  - Endpoint: `POST /admin/api/channels/:channel/members`
- Hapus anggota channel.
  - Endpoint: `DELETE /admin/api/channels/:channel/members/:agent`
- Tipe channel yang dipakai di pesan: `all-agent`, `dm:<a>:<b>` dengan nama diurutkan alfabetis, atau channel custom.

## 4. Pesan bus (Feed)

Tipe `MessageRecord`:
- `id: number`
- `sender: string`
- `channel: string`
- `priority: string`, nilai valid `low | normal | urgent`
- `audience: string`, nilai valid `agents | luki`
- `ts: string`
- `body: string`
- `reply_to?: number | null`
- `edit_version?: number | null`
- `edited_at?: number | null`
- `deleted_at?: number | null`

Fitur:
- Daftar pesan admin.
  - Endpoint: `GET /admin/api/messages`
  - Query: `channel?`, `sender?`, `priority?`, `q?`, `since?`, `limit?`
  - `since` adalah id pesan, hanya pesan dengan id lebih besar yang dikembalikan. `limit` default 50, minimum 1, maksimum 200.
  - `q` mencari substring di `body`, dengan karakter `%` dan `_` dihapus dari query sebelum pencarian.
  - Urutan: `id` menurun.
  - Respons: `{messages: MessageRecord[]}`
  - Batasan backend yang wajib dicatat di implementasi: SELECT endpoint ini hanya mengembalikan `id, sender, channel, priority, audience, ts, body`. Field `reply_to` tidak dikembalikan oleh endpoint history ini, sehingga tampilan thread dari history saja tidak bisa mengikat balasan ke pesan asal. Event live `bus.message` membawa `reply_to`.
  - Tidak ada endpoint GET satu pesan. Konsekuensi untuk klien: login ulang atau ganti URL tidak boleh membuang posisi Feed; klien wajib menyimpan anchor/cursor Feed secara persisten supaya tab-return dan re-login tidak kembali ke atas.
- Kirim pesan sebagai admin.
  - Endpoint: `POST /admin/api/send`
  - Request: `{channel: string, body: string, priority?: string, audience?: string, reply_to?: number | null}`
  - `channel` dan `body` wajib. `priority` default `normal`, `audience` default `agents`.
  - `reply_to` jika diisi harus integer, pesan target harus ada, dan channel target harus sama dengan channel kirim, jika tidak backend mengembalikan 400.
  - Pengirim yang tersimpan selalu `"luki"`, field pengirim dari klien diabaikan server.
  - Respons: `{ok: true, id: number}`
  - Event yang dipancarkan: `bus.message` dengan payload pesan lengkap termasuk `reply_to`.
- Edit pesan.
  - Endpoint: `PUT /admin/api/messages/:id`
  - Request: `{body?: string, priority?: string, channel?: string}`, minimal satu field yang valid harus berubah, jika tidak 400 `nothing to update`.
  - Pesan tidak ditemukan: 404 `message not found`.
  - Respons: `{ok: true, id: number}`
  - Event: `bus.message.edited`.
  - Batasan backend: edit menimpa `body` di database tanpa menulis `edit_version`/`edited_at`, dan event `bus.message.edited` hanya membawa `{id, body}`. Akibatnya history selalu menampilkan body terbaru tanpa penanda edited; klien hanya bisa menandai edited dari event live yang sempat terekam, install baru tidak akan pernah tahu pesan lama pernah diedit.
- Hapus pesan.
  - Endpoint: `DELETE /admin/api/messages/:id`
  - Pesan tidak ditemukan: 404 `message not found`.
  - Respons: `{ok: true, id: number}`
  - Event: `bus.message.deleted`, dan baris pesan dihapus dari database, bukan soft-delete.
- Stream live.
  - Endpoint: `GET /poll?since_ts=&since_id=&admin=1`
  - Cursor komposit `(ts, id)`, seed awal `(0, 0)`. Cursor wajib disimpan durable, bukan hanya di memori; cold start tanpa cursor = seed `(0, 0)` = full reload.
  - Event yang relevan: `bus.message`, `bus.message.edited`, `bus.message.deleted`, `kanban.*`, `channel.*`, `agent.*`.
  - Respons poll membawa flag `resync_required` saat cursor sudah tidak valid. Jika flag ini muncul, klien wajib melakukan full reload, bukan incremental update.
  - WebSocket `GET /ws` adalah transport alternatif untuk event yang sama. Poll adalah fallback.
- Ekspor dan impor data bus, admin only.
  - `GET /admin/export` mengembalikan `{messages, agents}`. Pesan diurutkan id menaik, field pesan yang diekspor adalah `id, sender, channel, priority, audience, ts, body`. Agen yang diekspor adalah `agent, created`, tanpa secret.
  - `POST /admin/import` menerima `{messages, agents}`. Array `agents` di payload TIDAK dipakai untuk registrasi ulang; handler hanya memproses `messages`. Setiap pesan wajib punya `id: number`, `sender: string`, `channel: string`, `ts: string`, `body: string`. Pengirim harus agen yang sudah terdaftar, jika tidak ditolak 400 `unknown sender`. Perlu verifikasi: round-trip ekspor lalu impor bisa gagal pada pesan bersender `luki` kalau `luki` bukan agen terdaftar; perilaku array `agents` ini harus dinyatakan eksplisit sebelum impor/ekspor masuk penerimaan. `priority` dan `audience` yang tidak valid diganti default `normal` dan `agents`. Duplikat id diabaikan, dan sequence id diperbaiki ke nilai maksimum setelah impor.
  - Respons impor: `{ok: true, imported: number}`

## 5. Project kanban

Tipe `ProjectRecord`:
- `id: number`
- `title: string`
- `description: string | null`
- `created_by: string | null`
- `created_at: number`
- `archived: number`, 0 aktif, 1 diarsipkan.
- Respons daftar menambahkan `task_count: number`.

Fitur:
- Daftar project.
  - Endpoint: `GET /admin/api/kanban/projects`
  - Urutan: `archived` menaik, lalu `id` menurun.
  - Respons: `{projects: ProjectRecord[]}` dengan `task_count` per project.
- Buat project.
  - Endpoint: `POST /admin/api/kanban/projects`
  - Request: `{title: string, description?: string, subscribers?: string[]}`
  - `title` wajib, setelah trim tidak boleh kosong.
  - `created_by` diisi dari user Basic auth, `archived` awal 0.
  - Respons: `{ok: true, id: number}`
  - Event: `kanban.project.created`.
- Ubah project.
  - Endpoint: `PUT /admin/api/kanban/projects/:id`
  - Request: `{title?: string, description?: string, archived?: 0 | 1 | boolean, subscribers?: string[]}`
  - Transisi ke `archived = 1` dari kondisi belum diarsipkan memancarkan event `kanban.project.archived`.
- Hapus project.
  - Endpoint: `DELETE /admin/api/kanban/projects/:id`
  - Menghapus project beserta task dan todo di dalamnya, sesuai kontrak admin.
- Daftar subscriber project.
  - Endpoint: `GET /admin/api/kanban/projects/:id/subscribers`
  - Respons: daftar `ProjectSubscriberRecord` dengan field `project_id, agent, added_by, added_at`.
- Daftar label project.
  - Endpoint: `GET /admin/api/kanban/projects/:id/labels`
  - Respons: daftar label yang dipakai task di project tersebut.

## 6. Task kanban

Tipe `TaskRecord`:
- `id: number`
- `project_id: number`
- `title: string`
- `description: string | null`
- `status: TaskStatus`, nilai `todo | doing | done | blocked`
- `assignee: string | null`
- `admin_assigned: string | null`, hanya diisi saat admin menetapkan assignee secara manual.
- `priority: TaskPriority`, nilai `low | normal | urgent`
- `created_at: number`
- `updated_at: number`
- `claimed_at: number | null`
- `blocked_kind?: BlockedKind | null`, nilai `waiting-human | waiting-task | waiting-external`
- `blocked_reason?: string | null`
- `status_changed_at?: number | null`
- `last_activity_at?: number | null`
- `stale_notified_at?: number | null`
- `notes?: string | null`
- `created_by?: string | null`
- `due_date?: number | null`, epoch detik integer.
- `lane: TaskLane`, nilai `backend | android | unassigned`

Tipe detail `TaskDetailResponse` adalah `TaskRecord` ditambah:
- `todos: TodoRecord[]`
- `labels: string[]`
- `comment_count: number`
- `activity_count: number`

Fitur:
- Daftar task per project.
  - Endpoint: `GET /admin/api/kanban/projects/:id/tasks`
  - Respons: task dengan todo tertanam.
- Detail task.
  - Endpoint: `GET /admin/api/kanban/tasks/:id`
  - Respons: `TaskDetailResponse`.
- Buat task, admin.
  - Endpoint: `POST /admin/api/kanban/projects/:id/tasks`
  - Request: `{title?: string, description?: string, notes?: string, priority?: TaskPriority, assignee?: string | null, lane?: TaskLane, due_date?: number | null, template?: string, template_vars?: Record<string, unknown>, labels?: string[]}`
  - Jika `template` dipakai, nilai default title, description, notes, priority, lane, dan labels diambil dari template, lalu ditimpa oleh field yang eksplisit dikirim. Placeholder di field template diganti dari `template_vars`; placeholder yang tidak ada di `template_vars` adalah error.
  - `due_date` harus integer epoch detik atau null, jika tidak 400 `invalid due_date`.
  - `lane` harus salah satu dari `backend | android | unassigned`, jika tidak 400 `invalid lane`.
  - Aturan assignee saat buat: jika `assignee` eksplisit null, task tetap unassigned. Jika `assignee` tidak dikirim dan `lane` adalah `backend` atau `android`, assignee otomatis diisi pemilik lane dari lane-mapping. Jika `lane` adalah `unassigned`, assignee tetap null.
  - Jika admin menetapkan assignee secara eksplisit, `admin_assigned` diisi dengan nilai yang sama, dan `claimed_at` diisi waktu saat ini.
  - Labels yang dikirim menggantikan labels template sepenuhnya, tidak di-merge.
  - Respons: `{ok: true, id: number, lane: TaskLane, assignee: string | null}`
- Ubah task, admin.
  - Endpoint: `PUT /admin/api/kanban/tasks/:id`
  - Request: `{title?, description?, notes?, status?, priority?, assignee?, blocked_kind?, blocked_reason?, due_date?, lane?, comment?, unblock?}`
  - Admin boleh mengubah task siapa pun, tanpa claim. Ini perbedaan utama dari endpoint agent yang dibatasi assignee.
  - Aturan lane dan assignee saat ubah: jika `lane` berubah dan `assignee` tidak dikirim, hasilnya tergantung status. Jika status `doing` atau `blocked` dan pemilik lane baru ada, assignee dialihkan ke pemilik lane baru. Jika status `todo` dan lane baru `unassigned`, assignee dikosongkan. Jika status `done`, assignee tidak berubah dan tidak ada wake yang dipancarkan. Beberapa kombinasi lane change dengan assignee yang sudah ada mengembalikan error `lane_change_conflict` beserta kondisi saat ini `{assignee, status, lane}`; klien wajib menampilkan error ini dan meminta assignee eksplisit, bukan menebak.
  - Jika `assignee` eksplisit null, `assignee` dan `admin_assigned` dikosongkan. Jika `assignee` eksplisit string, `admin_assigned` diisi nilai yang sama dan `claimed_at` diperbarui.
  - Setiap perubahan field yang relevan memancarkan event kanban dengan field `change` yang sesuai.
- Hapus task.
  - Endpoint: `DELETE /admin/api/kanban/tasks/:id`
- Aturan status blocked, rev5, wajib diimplementasi persis:
  - Pindah dari status bukan blocked ke `blocked` wajib membawa `blocked_reason` yang setelah trim panjangnya 1 sampai 280 karakter. Jika tidak ada alasan di payload dan tidak ada alasan tersimpan, backend mengembalikan 400 `blocked_reason required when status=blocked`.
  - `blocked_kind` jika tidak dikirim default ke `waiting-human` atau ke nilai tersimpan sebelumnya. Nilai valid hanya `waiting-human | waiting-task | waiting-external`, jika tidak 400 `blocked_kind must be waiting-human|waiting-task|waiting-external`.
  - Update dari `blocked` ke `blocked` hanya mengubah kind atau reason, dan memancarkan event dengan `change = blocked_kind`, bukan `change = status`.
  - Mengirim `blocked_kind` atau `blocked_reason` tanpa status `blocked` mengembalikan 400 `blocked_kind only valid with status=blocked`.
  - Keluar dari status `blocked` ke status lain wajib mengosongkan `blocked_kind` dan `blocked_reason` menjadi null, dan memancarkan event `kanban.task.unblocked`.
  - Payload event blocked memuat `id, task_id, lane, assignee, blocked_kind, blocked_reason`.
  - Klien wajib meminta reason sebelum mengirim status blocked, dan menonaktifkan aksi block sampai reason terisi. Pembatalan tidak mengirim patch apa pun.
- Stale: task dengan status `doing` dan `last_activity_at` lebih dari 86400 detik yang lalu dihitung stale di summary. Ini definisi backend, bukan ambang yang bisa diubah klien.

## 7. Todo task

Tipe `TodoRecord`:
- `id: number`
- `task_id: number`
- `text: string`
- `done: number`, 0 belum, 1 sudah.
- `sort_order: number`

Fitur:
- Buat todo, admin.
  - Endpoint: `POST /admin/api/kanban/tasks/:id/todos`
  - Request: `{text: string, sort_order?: number}`
  - `text` wajib setelah trim tidak kosong. `sort_order` default 0 jika bukan integer.
  - Task tidak ditemukan: 404 `task not found`.
  - Respons: `{ok: true, id: number}`
  - Event: `kanban.todo.added`, dan task disentuh (`last_activity_at` diperbarui) serta dicatat di activity task.
- Ubah todo, admin.
  - Endpoint: `PUT /admin/api/kanban/todos/:id`
  - Request: `{text?: string, done?: 0 | 1 | boolean, sort_order?: number}`
  - Minimal satu perubahan valid, jika tidak 400 `nothing to update`.
  - Todo tidak ditemukan: 404 `todo not found`.
- Hapus todo, admin.
  - Endpoint: `DELETE /admin/api/kanban/todos/:id`

## 8. Komentar task

Tipe `TaskCommentRecord`:
- `id: number`
- `task_id: number`
- `author: string`
- `body: string`
- `ts: number`

Fitur:
- Daftar komentar.
  - Endpoint: `GET /admin/api/kanban/tasks/:id/comments`
  - Urutan: `ts` menaik, lalu `id` menaik.
  - Respons: `{comments: TaskCommentRecord[]}`
  - Komentar bersifat append-only, tidak ada endpoint hapus komentar di admin API.
- Tambah komentar, admin.
  - Endpoint: `POST /admin/api/kanban/tasks/:id/comments`
  - Request: `{body: string}`
  - Author yang tersimpan untuk admin adalah `"admin"`.
  - Task tidak ditemukan: 404 `task not found`.

## 9. Label task

Validasi label, rev5:
- Setiap label di-trim dan di-lowercase, lalu harus cocok dengan regex `^[a-z0-9_-]{1,32}$`. Jika tidak, backend mengembalikan 400 `invalid label`.
- Duplikat setelah normalisasi dihapus.

Fitur:
- Tambah label.
  - Endpoint: `POST /admin/api/kanban/tasks/:id/labels`
- Hapus label.
  - Endpoint: `DELETE /admin/api/kanban/tasks/:id/labels/:label`
- Daftar label per project: lihat bagian project.
- Saat buat task, field `labels` menggantikan labels template sepenuhnya, tidak di-merge.

## 10. Pencarian, activity, dan summary kanban

Tipe filter `TaskSearchOpts`:
- `q?: string | null`
- `status?: string | null`
- `assignee?: string | null`
- `label?: string | null`
- `blocked_kind?: string | null`
- `priority?: string | null`
- `lane?: string | null`
- `stale?: boolean`
- `dueDateFrom?: number | null`
- `dueDateTo?: number | null`
- `dueDateFilter?: overdue | none | null`
- `sort?: string | null`
- `includeArchived?: boolean`
- `subscriberAgent?: string | null`
- `projectIds?: number[] | null`

Fitur:
- Pencarian global, admin.
  - Endpoint: `GET /admin/api/kanban/tasks/search`
  - Endpoint per project: `GET /admin/api/kanban/projects/:id/tasks/search`
  - Filter di atas digabungkan dengan AND.
- Activity, admin.
  - Endpoint: `GET /admin/api/kanban/activity`
  - Query: `limit?`, default 50, maksimum 200, nilai bukan integer atau kurang dari 1 mengembalikan 400 `invalid limit`.
  - Urutan: `ts` menurun, lalu `id` menurun.
  - Item activity memuat id komentar atau log, `task_id`, `project_id`, judul task, dan status task.
- Summary, admin.
  - Endpoint: `GET /admin/api/kanban/summary`
  - Endpoint per project: `GET /admin/api/kanban/projects/:id/summary`
  - Query global: `project_id?`, `include_archived?` dengan nilai `1` untuk menyertakan project yang diarsipkan.
  - Respons:
    - `by_status: {todo: number, doing: number, blocked: number, done: number}`
    - `by_lane: {backend: number, android: number, unassigned: number}`
    - `by_assignee: Record<string, {todo: number, doing: number, blocked: number, done: number}>`, kunci `unassigned` untuk task tanpa assignee.
    - `stale_count: number`, task `doing` dengan `last_activity_at` lebih dari 86400 detik lalu.
    - `overdue_count: number`, task dengan `due_date` sebelum awal hari ini Jakarta dan status bukan `done`. Jangan hitung overdue lokal pakai midnight perangkat kalau timezone perangkat beda; patokannya awal hari Jakarta dari backend.
    - `needs_human_count: number`, task `blocked` dengan `blocked_kind = waiting-human`.
- Needs adalah tampilan turunan, bukan endpoint terpisah: filter `status = blocked` dan `blocked_kind = waiting-human`, dari pencarian global atau dari daftar task per project. Admin boleh mengubah status task tersebut dari Needs, karena admin tidak dibatasi assignee.

## 11. Agen

Tipe `AgentRecord` yang diekspos admin, tanpa secret:
- `agent: string`
- `created: string`
- `last_seen?: string | null`
- `rate?: {used: number, limit: number, windowSec: number}`
- `transport?: ws | poll`, `ws` jika agen sedang terhubung WebSocket, selain itu `poll`.

Fitur:
- Daftar agen terdaftar.
  - Endpoint: `GET /admin/api/registered`
  - Mengembalikan agen dengan `created`, `last_seen`, pemakaian rate limit di window saat ini, dan transport.
- Daftar agen dan koneksi live.
  - Endpoint: `GET /admin/api/agents`
  - Mengembalikan agen dengan status koneksi, `connectedSince`, dan jumlah koneksi.
- Daftar agen publik, tanpa secret.
  - Endpoint: `GET /agents`
- Daftarkan agen baru, admin.
  - Endpoint: `POST /admin/api/agents`
  - Secret agen baru hanya ditampilkan sekali di respons. Klien wajib menampilkan secret ini sekali dan tidak menyimpannya di tempat yang bisa dibaca ulang dari backend, karena backend tidak mengembalikan secret di daftar.
- Hapus agen, admin.
  - Endpoint: `DELETE /admin/api/agents/:agent`
  - Efek: membership channel agen tersebut ikut dihapus, agar daftar anggota tetap akurat.
- Rotate secret agen, admin.
  - Endpoint: `POST /admin/api/agents/:agent/rotate`
  - Secret baru hanya ditampilkan sekali di respons.
- Catatan: endpoint `POST /admin/agents` adalah alias lama dari endpoint admin di atas, dan tetap admin only.

## 12. WIP dan lane mapping

Tipe `WipWarning`:
- `assignee: string`
- `doing_count: number`
- `limit: number`

Tipe `LaneMappingRecord`:
- `agent: string`
- `lane: TaskLane`
- `set_by: string`
- `set_at: number`

Fitur:
- Baca konfigurasi WIP.
  - Endpoint: `GET /admin/api/kanban/wip`
  - Mengembalikan `per_assignee_doing_limit` dari baris konfigurasi tunggal.
- Ubah konfigurasi WIP.
  - Endpoint: `PUT /admin/api/kanban/wip`
  - Request: `{per_assignee_doing_limit: number}`
- Baca lane mapping.
  - Endpoint: `GET /admin/api/kanban/lane-mapping`
  - Respons: daftar `LaneMappingRecord`.
- Ubah lane mapping.
  - Endpoint: `PUT /admin/api/kanban/lane-mapping`
  - Lane mapping menentukan pemilik lane untuk auto-assign task saat buat task tanpa assignee eksplisit, dan untuk pengalihan assignee saat lane berubah.
- Peringatan WIP: saat task dibuat atau status berubah menjadi `doing` dan assignee melewati limit, respons membawa `wip_warning: WipWarning`. Klien wajib menampilkan peringatan ini, bukan memblokir aksi secara diam-diam, karena backend sendiri tidak memblokir dari field ini saja.

## 13. Template task

Tipe `TaskTemplateRecord`:
- `id: number`
- `name: string`
- `title: string`
- `description: string | null`
- `notes: string | null`
- `priority: TaskPriority`
- `lane: TaskLane`
- `labels: string`, JSON array string di database, dikembalikan API sebagai array string.

Fitur:
- Daftar template, admin.
  - Endpoint: `GET /admin/api/kanban/templates`
  - Urutan: `id` menaik.
  - Respons: `{templates: TaskTemplateRecord[]}` dengan `labels` sudah diparsing menjadi array.
- Buat template, admin.
  - Endpoint: `POST /admin/api/kanban/templates`
  - Request: `{name: string, title: string, description?: string, notes?: string, priority?: TaskPriority, lane: TaskLane, labels?: string[]}`
- Pakai template saat buat task: lihat bagian task. Template tidak punya endpoint ubah atau hapus di admin API yang dicek untuk SPEC ini.

## 14. Hal yang sengaja TIDAK ada di SPEC ini

- Desain UI. Tidak ada nilai desain di SPEC ini.
- Desain adalah pekerjaan Argon di lane terpisah, dengan toolkit Compose, dan tidak boleh dicampur ke SPEC fitur ini.
- Fitur yang tidak punya endpoint admin di API live: FCM atau push device registry, widget home screen, dan katalog komponen System yang tidak punya backend.
- Mode agent Bearer: claim task, release task, dan update task yang dibatasi assignee. Admin tidak memakai jalur itu. Jika sebuah fitur hanya ada di endpoint agent, fitur itu tidak masuk SPEC admin ini kecuali disebutkan sebagai pembanding.
- Perubahan backend yang breaking. Jika sebuah fitur membutuhkan field baru di API, itu adalah pekerjaan backend terpisah, bukan bagian dari SPEC ini.

## 15. Checklist penerimaan, level fitur

- Login admin Basic berhasil, dan password baru minimal 12 karakter bisa dipakai login ulang.
- Stats menampilkan `messagesToday`, `totalMessages`, `perChannel`, dan `registeredAgents` dari API, bukan angka hardcode.
- Feed bisa daftar dengan filter channel, sender, priority, dan pencarian `q`, kirim pesan dengan `reply_to` yang valid, edit pesan, dan hapus pesan, dengan event live yang sesuai.
- Project bisa dibuat, diubah, diarsipkan, dan dihapus, dengan `task_count` yang benar.
- Task bisa dibuat dari template dan tanpa template, dengan auto-assign lane yang benar, dan dengan labels yang lolos regex.
- Aturan blocked rev5 ditegakkan: block tanpa reason ditolak 400, unblock mengosongkan kind dan reason, update blocked ke blocked tidak mengubah status.
- Todo, komentar, dan label task bisa dibuat, diubah, dan dihapus sesuai endpoint, dengan activity task yang tercatat.
- Pencarian global, activity, dan summary menampilkan angka yang konsisten dengan data task yang sama.
- Agen bisa didaftarkan, dihapus, dan di-rotate, dengan secret baru hanya tampil sekali.
- WIP dan lane mapping bisa dibaca dan diubah, dan peringatan WIP tampil saat limit terlampaui.
- Implementasi yang mengacu ke SPEC ini tidak mengambil desain dari SPEC ini. Jika implementasi membutuhkan desain, desain itu harus datang dari pekerjaan desain baru, bukan dari SPEC ini.
- Cursor poll tersimpan durable; cold start tidak kehilangan posisi, dan flag `resync_required` memicu full reload.
- Posisi Feed bertahan lewat login ulang dan ganti URL (anchor/cursor persisten), tidak kembali ke atas.
- Operasi destruktif (hapus channel beserta pesannya, hapus project beserta task+todo, hapus agen beserta membership) wajib konfirmasi eksplisit sebelum dieksekusi, bukan satu tap.
- Semua kontrol berfungsi dengan data live dari backend, bukan data mock atau angka hardcode.

## 16. Catatan untuk nosmile99, penambah SPEC

Bagian ini sengaja dibiarkan terbuka untuk tambahan dari nosmile99.
- Tambahkan fitur admin API yang terlewat dari daftar di atas, dengan endpoint, tipe, dan validasi yang sama persis seperti backend.
- Tambahkan batasan backend yang ditemukan dari pengalaman device, misalnya field history yang tidak mengembalikan `reply_to`, atau perilaku poll dan WebSocket di perangkat nyata.
- SPEC ini hanya berisi fitur. Jangan tambahkan desain ke SPEC ini.
- Jika ada fitur yang hanya ada di endpoint agent dan dibutuhkan admin, catat sebagai gap backend, bukan sebagai fitur admin yang sudah ada.
- Gap backend (bukan fitur admin): activity per project hanya ada di endpoint agent (`GET /api/kanban/projects/:id/activity`); admin hanya punya activity global (`GET /admin/api/kanban/activity`). Layar project admin tidak bisa tarik activity scoped; pilihannya filter global di klien, atau backend menambah endpoint admin sebagai pekerjaan terpisah.
- 2026-10-30 (perintah langsung #642, menindaklanjuti temuan #641): koreksi S0 (413), S3 (bentuk respons channel + DM system-managed), S4 (edit tanpa penanda edited, impor mengabaikan array `agents`) dan saran device (cursor durable, label UTC, overdue Jakarta, anchor Feed persisten, konfirmasi destruktif) dimasukkan ke SPEC ini; gap activity per project dicatat di atas.
