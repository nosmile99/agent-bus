# SPEC: Android Admin App Agent Bus

Status: DRAFT, 2026-10-30, dengan addendum revamp v12 2026-11-02 (bagian 17).
Sumber kebenaran API: backend live `https://agent-bus-do.lukiznr.workers.dev`, kode `src-backend/types.ts`, `src-backend/routes/*.ts`, `src-backend/handlers/*.ts` pada commit backend rev5 `b1b854b` untuk baseline, ditambah branch `revamp-v12` (berbasis master `8db4542`, belum commit, BELUM deploy ke Worker live) untuk semua yang ditandai revamp v12 di SPEC ini. Klaim yang hanya berlaku untuk kode revamp v12 ditandai demikian; jangan menganggapnya sudah live sebelum deploy.
Menggunakan Compose.

## 0. Konvensi umum

- Auth untuk semua endpoint di SPEC ini: HTTP Basic admin. Endpoint agent Bearer (`/api/*`) bukan bagian dari SPEC ini, kecuali disebutkan sebagai pembanding.
- Semua respons error berbentuk `{error: string}`. Kode yang dipakai backend: 400 validasi, 401 auth, 403 akses ditolak, 404 tidak ditemukan, 409 konflik, 413 body terlalu besar (maks 8192 byte, dipakai endpoint kirim pesan dan body kanban), 429 rate limit (endpoint agent revamp v12: dependency dan ledger; lihat bagian 17).
- `GET /panel` TIDAK ada di router revamp v12 (`app.notFound` mengembalikan 404); panel web sudah dihapus pada backend-only cleanup sebelum revamp. SPEC ini tidak lagi mengasumsikan panel web apa pun.
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
  - Efek samping: kredensial lama di klien menjadi tidak berlaku, login ulang diperlukan. (Panel web tidak lagi ada; lihat bagian 0.)
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
  - Revamp v12: unarchive project mengevaluasi ulang dependency dalam SATU transaksi yang sama dengan UPDATE project (aturan rule 8): task blocked waiting-task yang blocker-nya sudah done di-restore, dan event unblock ditulis; task yang tidak punya blocker done maupun unfinished (blocker dihapus selagi archived) di-restore dengan satu event `unblock: unlink` dan `blocker_id` NULL (migrasi v8, lihat bagian 17).
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
- Revamp v12: `blocked_from_status?: string | null` (status sebelum pertama kali ter-block oleh dependency; hanya di-set pada transisi pertama ke blocked) dan `unblocked_at?: number | null` (epoch detik; hanya untuk daftar unblocked, bukan field status).
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
- Revamp v12: `dependencies: {blockers: [{id, title, status}], blocked_by: [{id, title, status}]}` (kedua arah) dan `ledger_refs: [{id, kind, title, scope, target_lane}]` (maksimal 20 row aktif pertama yang merujuk task ini, difilter aturan target_lane yang sama dengan list ledger; admin melihat semua) plus `ledger_ref_count` yang hanya menghitung row aktif yang terfilter. Jika perpanjangan ini belum diimplementasi, klaim "ledger references" di Phase 3 gugur (plan v12 §6).
- Revamp v12: `comment_count` TIDAK menghitung komentar yang di-soft-delete (lihat bagian 8).

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
- Aturan status blocked revamp v12 (dependency), tambahan dari aturan rev5 di bawah:
  - Dependency: `POST /api/kanban/tasks/:id/dependencies {blocker_id}` (agent Bearer) dan `POST /admin/api/kanban/tasks/:id/dependencies {blocker_id}` (admin Basic). Daftar: `GET /api/kanban/tasks/:id/dependencies` dan versi admin-nya (kedua arah). Hapus: `DELETE /api/kanban/tasks/:id/dependencies/:blocker_id` (owner atau admin) dan versi admin-nya.
  - Daftar unblocked: `GET /api/kanban/tasks/unblocked?project_id=&limit=&after_id=` (agent: hanya milik sendiri + unassigned yang bisa dibaca; admin: semua). Predicate: `unblocked_at IS NOT NULL AND status = 'todo'`; urutan `unblocked_at` menaik lalu `id` menaik; `after_id` yang menunjuk row yang `unblocked_at`-nya sudah dibersihkan ditolak 400. Claim segar membersihkan `unblocked_at` dalam transaksi yang sama; re-claim idempotent oleh pemilik yang sudah sama JUGA membersihkannya — blanket-clear tanpa pengecualian (DIKOREKSI §17.11 item 0; kalimat lama yang menyebut preservasi adalah deviasi round 5 yang sudah di-revert atas kata Luki 2026-11-03).
  - Block oleh dependency memakai kind `waiting-task` dan reason BUATAN SERVER `"Waiting for task {blocker_id}: {blocker_title}"` (dipotong 500 karakter), bukan reason ketikan manusia. Precedence error link: 404 task/blocker hilang → 403 kepemilikan → 400 self-link → 400 cross-project → 400 archived → 400 task done → 409 blocker done → 409 duplikat → 409 cycle.
  - Perubahan status manual pada task yang ter-block oleh dependency di-gate (rule 9): seluruh request ditolak bila melanggar gate, bukan sebagian diterapkan. Hapus dependency terakhir yang belum selesai pada task waiting-task me-restore status dari `blocked_from_status`, mengosongkan kind/reason/`blocked_from_status`, dan mengisi `unblocked_at` dalam transaksi yang sama (rule 4a), dengan event unlink DAN unblock.
  - Event dependency dicatat di tabel `dependency_events` (bukan tabel poll `events`): action `link | unlink | reblock | unblock`. Event orphan unarchive memakai `blocker_id` NULL (migrasi v8) — bukan blocker id 0 dan bukan self-id.
  - Aturan status blocked, rev5, wajib diimplementasi persis (tetap berlaku untuk block manual):
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
  - Revamp v12, koreksi atas kalimat append-only di atas: komentar BISA di-soft-delete, hanya via admin: `POST /admin/api/kanban/tasks/:id/comments/:comment_id/soft-delete {reason}` (admin Basic, reason wajib non-empty, task/komentar tidak ditemukan 404). Soft-delete mengisi `deleted = 1, deleted_by, deleted_reason, deleted_at`; daftar default TIDAK menampilkan komentar yang dihapus, dan `comment_count` tidak menghitungnya. Admin bisa melihat yang dihapus lewat `GET /admin/api/kanban/tasks/:id/comments?include_deleted=true` (field deleted ikut dikembalikan). Tidak ada hard-delete komentar; pengecualian lama "archived project mengizinkan comment create" tetap berlaku di handler agent (cek subscriber/assignee saja, tanpa cek archived).
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
- Revamp v12, aturan unlink: unlink TIDAK auto-claim dan TIDAK mengubah status. Jalur agent: hanya owner task atau admin (non-owner non-admin 403; task unassigned tidak bisa di-unlink non-admin karena tidak ada owner untuk diverifikasi; project archived 403 `project archived`). Jalur admin: selalu diizinkan sebagai admin. Tambah label tetap lewat auto-claim yang sudah ada (unassigned todo → claim ke doing; unassigned blocked/done/doing → 409; task milik orang lain → 409; non-subscriber → 403).
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
- Perubahan backend yang breaking, KECUALI revamp v12 yang justru breaking dan dicatat di bagian 17: tabel baru (migrasi v7/v8), endpoint baru, field detail baru, dan `blocker_id` nullable. Klien yang mem-parsing ketat harus diperbarui; klien Android yang memakai `ignoreUnknownKeys = true` menoleransi field detail baru tanpa perubahan kode. Jika sebuah fitur lain membutuhkan field baru di API, itu adalah pekerjaan backend terpisah, bukan bagian dari SPEC ini.

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
- Revamp v12: dependency bisa di-link/unlink dan daftar unblocked menampilkan task yang di-restore ke todo; task detail membawa `dependencies` dan `ledger_refs`/`ledger_ref_count` (count = TOTAL row aktif terfilter, bukan jumlah yang dikembalikan; `ledger_refs` dibatasi 20 + `has_more`); komentar bisa di-soft-delete admin dan tidak dihitung di `comment_count`; endpoint ledger agent + admin (create/list/get/supersede/tombstone, seed admin, demote-recording admin) merespons sesuai bagian 17; path agent dependency/ledger yang melewati rate limit mengembalikan 429; `GET /panel` mengembalikan 404.
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

## 17. Addendum revamp v12 (branch `revamp-v12`, BELUM deploy; plan terkunci v12)

Status implementasi pada saat addendum ini ditulis: kode ada di branch `revamp-v12`, belum commit, belum push, belum deploy. Semua endpoint di bawah ini ada di `src-backend/routes/kanban.ts` dan `src-backend/routes/ledger.ts` pada branch tersebut, BUKAN di Worker live, sampai ada tap push + deploy terpisah. Plan terkunci: `agent-bus-revamp-plan-v12-DRAFT.md` (status LOCKED; jawaban lock: dependencies dulu, tanpa seed dulu, agy + Claude Code didaftarkan, human view boleh stale, demote per-row actor + deadline, post-hoc §5 untuk v1, pending-state ditunda).

### 17.1 Dependency (plan §4)

- Agent Bearer dan admin Basic, tidak pernah dicampur: `POST /api/kanban/tasks/:id/dependencies`, `GET /api/kanban/tasks/:id/dependencies`, `DELETE /api/kanban/tasks/:id/dependencies/:blocker_id`, `GET /api/kanban/tasks/unblocked`, dan versi `/admin/api/kanban/...` yang sama. Admin melihat semua task di unblocked; agent hanya milik sendiri + unassigned yang bisa dibaca.
- Tabel: `task_dependencies(blocker_id, blocked_id)` dan `dependency_events(blocker_id NULLABLE sejak v8, blocked_id, actor, action, reason, created_at)` dengan action `link | unlink | reblock | unblock`. Audit dependency TIDAK masuk tabel poll `events`.
- Rate limit agent: path dependency agent melewati `rlCheck` (default 10/60 detik; wren 10/3600 detik) dan mengembalikan 429 bila habis; path admin exempt.
- Seed gates (§8 plan, MASIH TERBUKA, bukan cacat addendum ini): live FK-delete test dan live luki-stamp test belum dijalankan karena sifatnya destruktif/live-state. Keduanya adalah gate implementasi, bukan gate lock.

### 17.2 Ledger (plan §5)

- Agent Bearer: `POST /api/ledger` (create), `GET /api/ledger` (list, filter kind/status/target_lane/q/limit/after_id/ref_type/ref_id, `include_history` agent selalu 403), `GET /api/ledger/:id`, `POST /api/ledger/:id/supersede`, `POST /api/ledger/:id/tombstone`.
- Admin Basic: `GET /admin/api/ledger`, `GET /admin/api/ledger/:id` (semua status), `POST /admin/api/ledger/:id/supersede`, `POST /admin/api/ledger/:id/tombstone`, `POST /admin/api/ledger/seed`, `POST /admin/api/ledger/:id/recheck-assignment` (`/demote` hanya alias kompatibilitas yang didokumentasikan).
- Create tanpa `bus_reconciliation_id` untuk row action-scope adalah 400 dengan hint format (bukan 403): plan §5 memasukkan ini ke aturan forbidden-field 400 ("scope action via this path alone"), sedangkan kegagalan verifikasi kredensial di supersede/seed/tombstone adalah 403. Split ini disengaja dan didokumentasikan, bukan inkonsistensi yang terlewat.
- Pagination anchor dicek seperti id-read; split 400/404 per endpoint dinyatakan dalam satu tabel di §17.9. Kalimat lama di sini yang menyebut `after_id` unblocked di luar predikat sebagai 404 adalah salah untuk sebagian kasus: anchor non-todo, project-salah, dan admin-archived adalah 400; 404 hanya untuk kegagalan visibilitas agent (lihat tabel §17.9).
- Alarm sweep per jam dibatasi: maksimal 20 project per sweep (tiap project sudah dibatasi 100+100 row-pass), window-nya berotasi per jam sehingga project di luar cap tetap tercapai di sweep berikutnya, tidak pernah starved oleh potongan first-N tetap.
- Kind: `decision | hold | gate | protocol | handover | dead-end | dissent`. Scope: `action | lane-note`. Status: `active | superseded | tombstoned`. Provenance: `bus_message | task | agent_asserted | luki_ordered | lock_ordered` (nilai `admin` sudah dihapus dari CHECK dan prosa).
- Endorsement action-scope: proposer mengirim pesan bus persis `PROPOSE: <title> | kind: <kind> | scope: <scope> | body_sha256: <hex>` (SHA-256 atas byte body ledger persis), reconciler membalas (`reply_to` = id proposal) dengan `ENDORSE: <title> | body_sha256: <hex>`; verifikasi parse-then-compare field yang di-trim, bukan kesamaan seluruh body. Caller ledger HARUS sama dengan author proposal, endorser HARUS berbeda dari keduanya, kalau tidak 403; satu endorsement hanya sekali pakai (pakai ulang 409 via `endorsement_uses`). Endorsement berlaku untuk CREATE dan SUPERSEDE agent atas row action-scope, TIDAK PERNAH untuk tombstone dan TIDAK PERNAH untuk supersede admin (admin supersede dikecualikan karena admin tidak punya identitas author pesan; otoritas penggantinya adalah admin Basic plus kredensial terproteksi bila row terproteksi).
- Endorsement luki hanya bisa dibaca di channel `all-agent` (verifikasi server-side lewat tabel messages, channel = `all-agent`); endorsement luki di DM/channel custom ditolak 403.
- Seed (admin only): row `luki_ordered` hanya bila `luki_message_id` terverifikasi sebagai pesan luki DAN belum dipakai seed lain (pakai ulang 409 via `seed_luki_uses`); seed tanpa kredensial 403; seed dengan `luki_message_id` tidak valid (sender salah atau id tidak ada) 403; seed dengan kedua kredensial sekaligus 400. Exception cutover: seed dengan `lock_decision_ref` TANPA `luki_message_id` hanya bila referensi berbentuk `lock:<YYYY-MM-DD>:<rule-slug>`, tanggalnya adalah cutover_date (server membandingkan tanggal UTC, hanya on-or-before, kalau tidak 403), diotorisasi keputusan lock (kalau tidak 403), dan belum dipakai (pakai ulang 409 via `seed_exception_uses`); row-nya `lock_ordered`, `is_luki_ordered = 0`, tidak pernah `luki_ordered`.
- Seed gates: endpoint seed ADA di kode, tetapi seed TIDAK BOLEH di-enable live sampai gate stamp (b) lolos dalam salah satu bentuk stamp; bila gate (b) gagal, seed kembali ke re-review, bukan sekadar "belum enabled". Lock Q6: TANPA seed dulu — MEMORY.md tetap otoritatif sampai seeding selesai; tidak ada rule yang di-seed pada cutover sampai Luki memerintahkan sebaliknya.
- Recheck-assignment (lock Q8, BUKAN endpoint §5 plan): `POST /admin/api/ledger/:id/recheck-assignment {actor, deadline}` HANYA mencatat actor + deadline recheck (admin atau agent terdaftar, kalau tidak 400; deadline timestamp integer Unix seconds di masa depan, kalau tidak 400) pada row aktif. Kolom storage tetap `demote_actor`/`demote_deadline`, tetapi permukaan user-facing memakai nama `recheck_actor`/`recheck_deadline` plus disclaimer ("scope and authority unchanged, no wake or message sent") di output list/get dan di reason event audit; nilai action event tetap `demote` karena CHECK `ledger_events` v7 mengenumerasikannya dan menggantinya butuh migrasi. Rute lama `/demote` hanya alias kompatibilitas. Recheck-assignment TIDAK mengubah scope, status, provenance, atau `is_luki_ordered`; pencabutan otoritas tetap hanya lewat supersede/tombstone dengan proteksi kredensialnya. Jadi recheck-assignment tidak pernah mencabut row terproteksi hanya dengan admin Basic.
- Blocklist (create/supersede body + title): email, telepon (termasuk grup spasi yang digabung dalam satu run), rekening/IBAN, secret (keyword + separator + >=16 karakter), alamat (jalan + nomor rumah + kode pos 5 digit, atau kota/kabupaten). Matching case-insensitive, substring/token dengan word boundary, bukan whole-field; positif/negatif tiap kategori ada di plan §5 dan di test revamp-v12.
- Admin send stamp, DIVERIFIKASI BUKAN BASI: SPEC bagian 4 sudah benar — `POST /admin/api/send` men-stamp sender selalu `"luki"`, field pengirim klien diabaikan. Salinan lokal `API-CONTRACT.md` (20 Oktober, di luar repo ini) yang mengklaim stamp `admin` adalah yang basi, bukan SPEC ini; salinan itu sengaja tidak diubah karena di luar repo.

### 17.3 Migrasi

- v7: tabel `task_dependencies`, `dependency_events`, `ledger`, `ledger_events`, `endorsement_uses`, `seed_exception_uses`, `seed_luki_uses`, plus kolom `tasks.blocked_from_status` dan `tasks.unblocked_at`.
- v8: `dependency_events.blocker_id` menjadi NULLABLE (recreate-table dalam satu `transactionSync`; idempotent via pengecekan `pragma_table_info`). Event orphan unarchive menulis `blocker_id` NULL dengan reason `unblock: unlink` — NULL berarti "tidak ada blocker", bukan self-id dan bukan 0.
- Versi migrasi yang diharapkan test rev5 pada branch ini: `[2, 3, 4, 5, 6, 7, 8]` (sebelum revamp: `[2, 3, 4, 5, 6]`).

### 17.4 Yang sengaja TIDAK berubah

- Semua endpoint admin dan agent rev5 di bagian 1–16 yang tidak disebut di atas tetap ada dengan rute yang sama (termasuk `/admin/api/send`, `/poll`, `/ws`, dan seluruh kanban admin/agent). Klien Android memakai `ignoreUnknownKeys = true` sehingga field detail baru (`dependencies`, `ledger_refs`, `ledger_ref_count`, `blocked_from_status`, `unblocked_at`) ditoleransi tanpa perubahan kode klien.
- `clients/do-inbox-poll.sh` TIDAK diubah perilakunya: endpoint `/poll?since_ts=&since_id=`, auth Bearer, cursor komposit `ts:id`, `resync_required`, filter `bus.message` + `kanban.*`, dan circuit breaker time-based 600 detik / 3 window semuanya masih cocok dengan handler poll saat ini. Koreksi fix round 4 atas batas lama di bawah: perubahan dependency SEKARANG membangunkan script ini lewat event poll — link row 1, re-block rule 6/unarchive, dan unblock rule 4/4a semuanya memancarkan `kanban.task.blocked`/`kanban.task.unblocked` (dan row stuck memancarkan `kanban.task.dependency_stuck`); yang tetap TIDAK memancarkan poll event adalah tulis ledger dan link/unlink yang tidak mengubah status (link-only/unlink-only), karena `ledger_events`/`dependency_events` adalah tabel audit, bukan tabel poll `events`. Klien yang butuh riwayat audit memakai endpoint audit baru di §17.5, bukan poll.
- `android/DESIGN.md` adalah dokumen desain saja, tidak mengklaim endpoint API, sehingga tidak ada klaim API basi di dalamnya yang perlu diperbaiki pada ronde ini.
- File `kanban-expansion-plan-rev5-DRAFT.md` yang untracked di repo adalah draf plan rev5, bukan dokumen API yang berlaku; sengaja tidak diubah.
- Ambiguitas lama tentang event dependency-driven SUDAH dijawab fix round 4 (item 3): `kanban.task.blocked`/`kanban.task.unblocked` DIPANCARKAN untuk perubahan status yang murni digerakkan dependency — link row 1, re-block, dan unblock rule 4/4a — bukan hanya lewat handler status kanban. Paragraf ambigu sebelumnya di addendum ini digantikan kalimat ini.

### 17.5 Fix round 4 (code-only, dari re-roast kedua)

- Skipped-unblock dedupe: sinyal row stuck (`system skipped unblock` + poll event `kanban.task.dependency_stuck`) ditulis SEKALI per episode stuck. Fix round 5 mengoreksi definisi episode dan hint ronde 4: episode = (`status_changed_at` terakhir, jumlah dependency_events task) — kunci lama (status saja) melewatkan episode link-cycle (link/unlink tidak mengubah `status_changed_at`) dan re-block sepersekian detik yang sama; hint lama salah di semua jalur caller (caller selalu menjaga nol unfinished blocker, sehingga payload `blocker_ids` selalu kosong dan re-link blocker done adalah 409 already-satisfied). Hint baru: pindahkan manual ke todo/doing saja; re-link hanya blocker yang masih unfinished sesudahnya bila ownership mesin diinginkan lagi. Payload menghilangkan `blocker_ids` kosong dan mencantumkan `finished_blocker_ids` dari link yang tersisa bila ada.
- Status agent: response menggemakan `auto_claimed`; field `comment` pada status write ditangani seperti admin update (insert task_comment + `kanban.comment.added`), tidak pernah diam-diam dibuang. Error kind-enum dan panjang reason divalidasi SEBELUM rate check (400 tanpa konsumsi kuota); teks error reason dipisah: tidak ada reason → `blocked_reason required when status=blocked`, bukan string → `blocked_reason must be a string`, panjang di luar 1–280 → `blocked_reason must be 1-280 characters`.
- Fan-out: response agent status, admin update, dan admin project unarchive membawa `dependency_fanout` `{processed, capped, pending_sweep}` bila pass fan-out berjalan; `capped: true` berarti sisa konvergen lewat alarm sweep per jam. Bukan endpoint sweep-progress terpisah (field response dipilih karena lebih sederhana dan melekat pada panggilan yang memotong).
- Alarm boot: `setAlarm(+5 menit)` di migrasi di-retry 3x, gagalnya di-log DAN dipersist ke tabel `bus_meta` (`alarm_boot`); tiap alarm run mencatat `alarm_last_run`/`alarm_last_error`/`alarm_reschedule_error` ke `bus_meta`; fetch-path re-arm: bila tidak ada run tercatat atau run terakhir >2 jam (cadence per jam + slack), request berikutnya me-re-arm +5 menit dan mencatat `alarm_rearm`. Kesehatan sweep diekspos di admin stats sebagai `sweepHealth`. Cadence tidak berubah (boot +5 menit, lalu per jam).
- Cascade delete task: event unlink per link ditulis batch multi-row seperti project delete, bukan satu INSERT per link.
- `unblocked_at`: release task todo (status tidak berubah, hanya unassign) MEMPERTAHANKAN stamp sehingga task tetap di unblocked list; PUT status same-status juga mempertahankannya. Membaca plan: "any transition out of todo" — no-op bukan transisi. Claim, status change nyata, dan move out of blocked tetap membersihkannya.
- Cycle 409: membawa `cycle_path` (jalur penutup terpendek dari BFS) atau keterangan fail-closed cap 100 edge, plus hint edge mana yang harus di-unlink. Cycle tetap quota-consuming karena hanya berjalan in-transaction (load graf penuh sengaja dilewat pre-check) — didokumentasikan, bukan disembunyikan. DFS diganti BFS agar node yang pertama kali dicapai lewat detour >100 edge tidak lagi memicu false-positive padahal ada jalur ≤100 edge; cap 100 tetap fail-closed.
- Pagination/cap: dependency list (`limit` + `after_id` id-cursor, clamp 100, `has_more`/`next_after_id`; tanpa limit = full list seperti sebelumnya), `/available` (`limit` clamp 100, `has_more`; tanpa limit = full), search task (`limit` clamp 200, default 200 = perilaku lama, `has_more`), comments (`limit` clamp 100 + `after_id`, `has_more`; tanpa param = full). Task list per project tanpa param query lain tetap full; `?limit=` pada list itu masuk jalur search pager.
- Default-kind trap: block todo/doing dengan unfinished links dan kind DIHILANGKAN (default waiting-human) ditolak 409 dengan hint (link lewat POST dependencies agar mesin memiliki waiting-task block, atau pass `blocked_kind` eksplisit). Block waiting-human EKSPLISIT dengan unfinished links tetap lolos: caller memilih manual wait, dan manual unblock adalah escape-nya. Pembedanya adalah omission vs choice.
- Re-block: format event diseragamkan ke plural `reblock: blocker_ids:<all>` di reopen maupun unarchive; `blocked_reason` re-block mencantumkan SEMUA unfinished blocker — fix round 5 menyeragamkan formatnya menjadi setiap item berawalan (`Waiting for task 3: A; Waiting for task 5: B`, dipotong 500 karakter), bukan hanya item pertama; row satu blocker tetap berbentuk plan `Waiting for task {id}: {title}`. Kolom `blocker_id` event reblock = blocker pertama (primary) dan reason mencantumkan semua — kesepakatan itu didokumentasikan, bukan disembunyikan. Re-block kini juga menulis system log seperti unblock dan block manual.
- Audit read: `GET /api/kanban/tasks/:id/dependencies/events` (+ admin) dan `GET /api/ledger/:id/events` (+ admin), read-only, visibilitas dan rate sama dengan list/get yang bersesuaian, pager `limit` (default 20, clamp 100) + `after_id`. Audit tidak lagi write-only.
- Detail payload: `count_note` menjelaskan `comment_count` (non-system, non-deleted) vs `activity_count` (semua row task_comments termasuk system log dan soft-deleted). Tombstone response menggemakan `status: 'tombstoned'` + `tombstone_reason`. Agent task update menolak unknown field 400 dengan `allowed` (general: title/description/notes/due_date/lane; convenience route: hanya field-nya); dependency link menolak unknown field 400 (`allowed: ['blocker_id']`). Split kode ref ledger didokumentasikan, bukan diseragamkan: ref target hilang = 400 (nilai referensi dalam payload), `replaces_tombstoned_id` hilang = 404 (mengalamatkan row yang ada). Komentar gate "pure no-op still passes" dikoreksi: no-op lolos bahkan untuk legacy orphan karena ia tidak mengubah apa-apa — rescue-nya adalah sinyal stuck di atas, bukan penolakan gate.
- Yang TIDAK diputuskan ronde ini (butuh kata Luki, daftar PIVOT tetap): isi body PROPOSE, kredensial Luki yang content-bound/single-use, enforcement hold, model konflik, flip cutover, penghapusan endorsement/blocklist, relabel advisory, stickiness row terproteksi, carve-out admin, surfacing stale-window di luar sinyal di atas, bentuk sheet di luar field di atas, bentuk rescue di luar escape di atas, batch wake, discovery endpoint, slimming, penghapusan recheck, threshold sweep-stack, kebijakan retensi audit.

### 17.6
### 17.6.x Unblock pass skips unfinished-link rows in SQL (fix round 5, M2 follow-up)
`depReevaluateProject`'s unblock pass now pages only blocked
waiting-task rows with NO unfinished link (`NOT EXISTS` over links
whose blocker status != 'done' — exactly `depUnfinishedBlockers`).
Rows with unfinished links were always no-ops in this pass (the
callback guards on zero unfinished links before restoring or
signalling), but they consumed the 500 candidate budget: after a
project re-evaluation's reblock pass re-blocks every todo task
holding an unfinished link, the blocked set stays past budget and a
late-id stuck row behind it was never reached by the pass at all
(found by the fix-round-5 regression test, not by a user report).
`pending_sweep` already reflected the budget remainder honestly; the
filter removes the starvation itself for this pass. The in-callback
guard stays as a safety net.
 Fix round 5 (code-only, dari re-roast ketiga)

- Fan-out jujur (M1): iterator fan-out kini melaporkan apakah kandidat yang belum diperiksa masih ada (sisa halaman + probe satu baris melewati id terakhir), sehingga 101 dependent tidak lagi dilaporkan `{processed:100, capped:false}`. `capped` = berhenti di cap 100 dengan kandidat menunggu; `pending_sweep` = sinyal sisa yang independen, bukan alias `capped`: true bila cap tercapai ATAU budget kandidat (500 yang diperiksa) habis dengan kandidat masih menunggu. Delay rotasi window sweep (proyek di luar window 20 per sweep) adalah sinyal level sweep di `sweepHealth.sweep_pending` (admin stats), bukan di response fan-out per panggilan; tidak ada janji deadline di luar cadence sweep per jam yang sudah ada. Fix round 6 (Domain M9): `sweep_pending` kini juga mencatat remainder NYATA dari proyek yang divisit — `pending_projects` (proyek yang `depReevaluateProject`-nya mengembalikan `pending_sweep`) dan `failed_projects` (proyek yang re-evaluasinya throw, masing-masing cap 20 id) — karena loop alarm lama membuang nilai kembali fan-out, sehingga cap di dalam proyek yang divisit tidak pernah sampai ke stats; `pending_sweep` kini true bila rotasi ATAU ada pending ATAU ada failed.
- Unarchive (M7): response unarchive kini membawa `dependency_fanout.processed` top-level (jumlah kedua pass), sesuai janji SPEC:495 bahwa semua jalur fan-out membawa `{processed, capped, pending_sweep}`. Delete task dan delete project kini membawa `dependency_cascade`, bukan hanya `{ok, id}`: task = `{links_removed, dependents_unblocked, unblocked_ids, capped, pending_sweep, snapshots_truncated}` (snapshot terpotong di budget 500 tetap berarti link terhapus set-based dan lengkap, tetapi dependent di luar window snapshot tidak dievaluasi in-call dan konvergen lewat sweep); project = `{links_removed, tasks_deleted}`. Loop re-evaluasi delete yang memotong di cap kini menandai capped, bukan diam.
- Alasan multi-blocker (M6): `blocked_reason` kini di-refresh ke himpunan unfinished SAAT INI pada link (row 1a/2), unlink, dan completion dengan blocker tersisa — sebelumnya hanya re-block yang me-refresh, sehingga reason bisa menyebut blocker yang sudah done sementara blocker lain masih memblokir. Format multi-blocker mengikuti penyeragaman di bawah (setiap item berawalan).
- Penerima event dependency (M9): event `kanban.task.blocked`/`unblocked`/`dependency_stuck` dari jalur dependency kini mencantumkan subscriber proyek (plus assignee) di `recipients`, konsisten dengan broadcast event manual. Proyek terbuka (tanpa daftar subscriber) tetap `recipients: null` (broadcast) — tidak bocor, karena proyek terbuka memang terbaca semua agent terdaftar menurut definisi. Bila assignee di-deregistrasi, event stuck tetap sampai ke subscriber proyek, bukan ke nama mati.
- Kelas stuck tak terlihat (M11): task blocked eksplisit waiting-human/waiting-external yang memegang unfinished link kini mendapat sinyal yang sama (system log + `kanban.task.dependency_stuck`, dedupe per episode seperti M2) lewat pass re-evaluasi done dan pass unarchive/sweep — sebelumnya ia dilewati diam-diam oleh semua jalur (rule 4 hanya waiting-task) dan manual unblock-nya 409 sampai SEMUA link di-unlink, yang hanya bisa ditemukan dengan mencoba unblock dan membaca hint. Hint-nya menyebut escape: unlink semua link, lalu manual unblock/move.
- Cursor dependency list (M3): SPEC §17.5 lama tidak menyebut cursor per-list sama sekali dan baris pagination-nya masih menyebut dep list sebagai "limit + after_id id-cursor" — dikoreksi di sini. Kontrak sekarang: `blockers_after_id`/`blocked_by_after_id` masing-masing, `after_id` legacy menginisialisasi cursor sebuah list HANYA bila id itu ada di list tersebut (fix round 6, API minor-8: perilaku lama menginisialisasi KEDUANYA, sehingga cursor yang hanya ada di satu list diam-diam memotong baris awal list lainnya); caller WAJIB mengirim kedua cursor per-list pada halaman berikutnya — mengirim hanya satu akan me-restart list lainnya dari 0 (replay), karena preservasi stateless atas cursor yang tidak dikirim adalah mustahil, dan perilaku itu didokumentasikan, bukan disembunyikan. String `"null"` diperlakukan sebagai tidak ada (bukan 400). Cursor NYATA (bukan `"null"`) tanpa `limit` adalah 400 (sebelumnya diam-diam mengembalikan full list); `"null"` bukan cursor sama sekali — ia dipetakan ke absent sebelum cek limit-required, jadi dep list/comments tanpa limit + `after_id=null` mengembalikan full list (200), bukan 400 (koreksi §17.10). Cursor di-validasi seperti anchor ledger/unblocked: id basi (tidak ada di list itu) = 404, bukan halaman kosong dengan `has_more:false`. `next_after_id` = null bila KEDUA list masih punya sisa (satu angka tidak bisa mengkode dua cursor); bila tidak, ia adalah max dari list yang punya sisa, untuk caller legacy satu list. Test regresi diperluas ke arah cap 100 (bukan hanya 3+3 di limit 2).
- Matematika kuota rescue (M4): rescue tetap 2N+1 panggilan (N unlink, 1 status PUT, N link); N=5 = 11 panggilan > 10/60 detik, dijamin 429 di tengah rescue, dan mustahil untuk wren 10/3600 detik — TIDAK dibangun endpoint rescue atomik (itu keputusan bentuk milik Luki). Yang diperbaiki tanpa memutuskan bentuknya: body 429 pada link/unlink dependency kini membawa hint rescue (tunggu `retry_after_seconds`, lalu coba ulang hanya link yang masih hilang setelah re-list dependency), dan retry re-link murah setelah window reset karena duplicate-link 409 adalah pre-check yang tidak mengonsumsi kuota (terverifikasi: ia kembali sebelum `rlCheck`).
- Cursor queue kerja (M5): `/available` dan search kini punya cursor NYATA berbasis offset (`?limit=&offset=`, response `next_offset`), karena sort default (due_date, priority, created_at, id) bukan id-ordered sehingga cursor id tidak bisa mem-page-nya. Kontrak lama (has_more:true dengan next_after_id:null dan "re-request dengan limit lebih besar" yang sendiri cap 100) membuat task 101+ tidak pernah bisa di-list lewat endpoint queue — kebohongan itu dihapus. Trade-off offset didokumentasikan: halaman offset bisa bergeser di bawah write konkuren. `next_after_id` tetap null untuk kompatibilitas; cursor-nya adalah `next_offset`.
- Sweep/alarm (M8): (a) pass re-block sweep kini mem-page hanya task yang punya link (predikat EXISTS), bukan semua row todo/doing dengan `depUnfinishedBlockers` per task; (b) `alarm_last_run` tidak lagi ditulis di START alarm — stamp kompletasi `alarm_last_completed` ditulis hanya bila seluruh body alarm sukses, dan fetch re-arm mengacu ke kompletasi (fallback ke `alarm_last_run` legacy), sehingga crash di tengah body tidak lagi mencatat run segar; (c) fetch re-arm di-throttle maksimal sekali per jam per episode mati (nilai `last_completed` yang sama); (d) gagal re-arm memancarkan event poll `kanban.sweep.rearm_failed` yang terlihat agent, bukan hanya log console dan `sweepHealth` admin — karena bila `setAlarm` sendiri yang rusak, re-arm yang hanya menjadwalkan gagal dengan cara yang sama; fix round 6: percobaan gagal JUGA menulis record throttle `alarm_rearm` (satu percobaan per jam per episode mati, seperti sukses) dan event hanya dipancarkan saat counter PERTAMA mencapai 2 (sekali per episode), bukan pada setiap kegagalan berikutnya — perilaku lama menulis throttle hanya saat sukses, sehingga `setAlarm` yang rusak di-retry setiap fetch dan membanjiri event (prune hanya jalan di dalam alarm()); (e) lihat definisi `pending_sweep` di atas (cap ATAU kehabisan budget ATAU delay rotasi di level sweep).
- Pesan Luki test (M10): ban pesan test (channel `v5-seed-test` atau body mengandung `TEST ONLY`) kini berlaku di SEMUA jalur verifikasi Luki, bukan hanya seed. Sebelumnya supersede/tombstone memanggil verifikasi hanya dengan `afterCreatedAt`, sehingga pesan Luki test yang dibuat setelah row bisa mengotorisasi supersede/tombstone terproteksi. Test regresi ditambahkan.
- Kontrak pagination (M12): parsing `limit` kini STRICT di dep list, dep events, unblocked, ledger list/events, `/available`, search, dan comments — `limit=abc` atau `limit=0` adalah 400 `invalid limit`, bukan koersi diam-diam ke default (perilaku lama), agar konsisten dengan error cursor. Comments: `after_id` tanpa `limit` kini 400 (sebelumnya diam-diam diabaikan sehingga caller paging tanpa limit mendapat full list berulang). Task list agent per proyek: query string APA PUN tetap me-routing ke search pager (bukan list) — didokumentasikan di sini, bukan diubah (perubahan perilaku akan memecah caller yang mengandalkan `?limit=` pada list itu).
- Siklus tanpa global (M13): `depLastCyclePath` (module-global, dibagi antar request) dihapus; jalur siklus kini di-thread lewat nilai kembali `depHasCycle` (`{cycle, path}`). Benar di bawah single-threading DO sebelumnya, tetapi rapuh; tidak ada lagi pewarisan path basi antar request.
- Audit re-block (M14): lihat format reason di atas; kolom event reblock = blocker pertama, reason = semua id, payload poll = semua id. Asimetri cap reason didokumentasikan, bukan dipotong paksa: reason server dipotong 500 karakter, sedangkan `blocked_reason` manual cap 280 — memotong reason server ke 280 akan memecah bentuk all-blocker, jadi asimetri ini dipertahankan dan dinyatakan.
- Minor dalam ronde yang sama: bare task list dan dep-list tanpa param tetap full list (didokumentasikan di sini sebagai default unbounded; opsi cap tersedia lewat `limit`/`offset` di endpoint yang mem-page, dan `kbTaskWithTodos` per task pada list proyek DIGANTI fix round 6 oleh `kbTasksWithTodos` batch (satu query IN per 50 task, bentuk row dan urutan todos sama — bukan perubahan perilaku, hanya penghapusan N+1)); iterasi link delete-cascade sengaja TIDAK di-budget: delete-nya set-based dan lengkap, dan event unlink adalah audit atas delete itu — budget akan diam-diam menghilangkan baris audit; paging membatasi memori, bukan kelengkapan, di sini; status check fan-out kini memakai proyeksi sempit (status/kind/archived dari JOIN) sehingga kandidat yang tidak cocok dilewati tanpa `depGetTask` full-row per kandidat; batch stale dibatasi 100 row per alarm dan prune event di-chunk 1000 row (maks 20 chunk per alarm, sisa konvergen alarm berikutnya); read audit dependency kini terindeks di kedua lengan OR (`idx_dep_events_blocker` ditambahkan di boot idempotent, tanpa versi migrasi baru); BFS siklus memakai pointer indeks, bukan `queue.shift()` O(n) per pop; payload reason-only admin pada task non-blocked kini 400 SEBELUM gate (bukan 409 yang bergantung state link); re-claim idempotent pada task yang sudah dimiliki MEMBERSIHKAN `unblocked_at` (blanket-clear, persis seperti claim segar — §17.11 item 0, revert deviasi round 5 atas kata Luki 2026-11-03); yang dipertahankan hanya release todo tanpa perubahan status dan PUT status same-status, yang memang bukan claim. comment pada status PUT kini membawa cap 8192 byte seperti endpoint comment, ditegakkan sebelum kuota sehingga berlaku juga pada PUT no-op; strictness unknown-field DIKOREKSI (bukan hanya didokumentasikan): endpoint yang menolak unknown field 400 dengan `field` + `allowed` adalah dep link, keluarga ledger/tombstone, DAN agent task update (kalimat lama yang menyebut hanya dua yang pertama adalah salah — baris §17.5 di atas sudah menyatakan task update menolak). Status PUT (agent maupun admin) TIDAK punya allowlist dan diam-diam membuang field tak dikenal — sehingga salah ketik `blocked_kind` pada block diam-diam ditulis sebagai kind default (`waiting-human`) — sementara task PUT umum di sebelahnya LOUD soal typo. Loudness yang tidak konsisten di dua PUT pada task yang sama ini adalah pilihan desain yang didokumentasikan, bukan diseragamkan paksa: perilaku status PUT tidak berubah ronde ini; response list ledger menggemakan filter efektif (`filters: {status, include_history, target_lane, kind, ref_type, ref_id, search}`).
- Yang TIDAK diputuskan ronde ini (butuh kata Luki, daftar PIVOT tetap dari ronde sebelumnya, ditambah bentuk rescue atomik dan ambang/retensi yang belum diputuskan): isi body PROPOSE, kredensial Luki yang content-bound/single-use, enforcement hold, model konflik, flip cutover, penghapusan endorsement/blocklist, relabel advisory, stickiness row terproteksi, carve-out admin, surfacing stale-window di luar sinyal di atas, bentuk sheet di luar field di atas, bentuk rescue di luar hint/kuota di atas, batch wake, discovery endpoint, slimming, penghapusan recheck, threshold sweep, kebijakan retensi audit, dissent, model lane, boundary ref-pointer, restore comment.

### 17.7 Fix round 6 (code-only, dari re-roast keempat)

- KILL — starvasi sweep reblock/stuck: pass re-block dan pass stuck `depReevaluateProject` memakai predikat EXISTS-any-link, sehingga row done-link-only mengonsumsi budget 500 kandidat dan — karena `depEachProjectTask` restart dari id 0 per panggilan — kandidat asli melewati posisi 500 TIDAK PERNAH dijangkau sweep per jam manapun (bukan sekadar tertunda). Keduanya kini memakai predikat unfinished-join yang sama dengan pass unblock (`EXISTS ... JOIN tasks b ... AND b.status != 'done'`, persis `depUnfinishedBlockers`): row tanpa unfinished link bukan no-op yang mengonsumsi budget lagi, melainkan tidak masuk page query sama sekali; guard di dalam callback tetap sebagai safety net. Test regresi: 501 filler todo + 501 filler human (masing-masing hanya link done) mendahului satu kandidat reblock asli dan satu row stuck asli — keduanya tercapai in-call, `reblocked.processed = 1`, `pending_sweep = false`.
- Fix-before-deploy — loop gagal re-arm: lihat koreksi (d) di M8 di atas (throttle gagal + event sekali per episode).
- Batched todos (Perf M2): search dan bare task list proyek kini memakai `kbTasksWithTodos` (satu query IN per 50 task), bukan satu query per task (search sampai 200 query sekuensial di atas scan `LIKE %q%`; bare list tak berbatas). Bentuk row dan urutan todos (`sort_order, id`) sama; chunk 50 menjaga batas 100 bound parameter, seperti batching pager unblocked.
- Beban siklus berbatas (Perf M3): `depHasCycle` kini `LIMIT 1001` pada query edge proyek (`DEP_CYCLE_EDGE_CAP = 1000`); graf di atas cap gagal tertutup (`cycle:true, path:[]`), filosofi yang sama dengan cap kedalaman 100 — himpunan edge yang terpotong tidak bisa membuktikan asiklik. Cap tidak pernah terpicu pada skala bus (digit tunggal); ia hanya menjaga proyek patologis. Test regresi: 1001 edge disjoint → gagal tertutup; rantai kecil tetap resolve dengan path terpendek.
- Stream cascade delete (Perf M4): event unlink cascade delete task kini di-stream dalam buffer 100 (flush per buffer, sebelum delete, transaksi sama), bukan diakumulasi seluruh list di memori — cascade delete project sudah men-stream per page; task delete tidak.
- Validasi dep-list sebelum kuota (API M1): parsing `limit`/cursor dan validasi anchor dep list kini berjalan SEBELUM `rlCheck`, sehingga error 400/404 cursor tidak mengonsumsi kuota — urutan lama (komentar lama mengakuinya) adalah kebalikan dari ledger/unblocked/dep-events/link/unlink yang semuanya validasi dulu. Test regresi: 10 error cursor 400 dengan `keepRate` diikuti satu panggilan valid yang tetap 200 (pada urutan lama panggilan ke-11 itu 429).
- Parsing cursor diseragamkan (e): SATU aturan di semua pager (dep list/events, unblocked, ledger list/events, `/available`, search, comments): digit ketat (`/^\d+$/`, `12abc`/`12.9` tidak lagi koersi via `parseInt`), dan string `"null"` (JSON null yang di-echo caller) diperlakukan sebagai tidak ada — untuk `limit`/`offset` maupun cursor. Perbedaan yang dipertahankan dan dinyatakan alasannya: (a) anchor-validation vs filter id mentah — dep list/ledger/unblocked memvalidasi anchor (id basi = 400/404) karena row bisa hilang (unlink) sehingga anchor basi ambigu, sedangkan dep events/comments adalah log append-only sehingga id basi sungguh berarti "caught up" (halaman kosong, `has_more:false`); (b) `/available` 400 pada `offset` tanpa `limit` sedangkan search default `limit` 200 — karena `/available` tanpa limit adalah unbounded sehingga offset saja tak bermakna, sedangkan search selalu punya limit. Legacy `after_id` dep list kini per-list (lihat koreksi M3 di atas).
- Hint gate kind-aware (API M3): gate pada task blocked dengan unfinished link kini membedakan kind — waiting-human/waiting-external mendapat hint escape yang benar (unlink semua link, lalu manual move), karena completion blocker TIDAK mengangkat block manual (rule 4 hanya waiting-task); hint lama ("finish ... first") salah untuk kelas ini. Test regresi menegaskan hint mengandung "unlink all" dan tidak berawalan "finish or unlink".
- Hint 429 langkah status (API M4): status PUT — langkah TENGAH rescue 2N+1 (unlink sudah diterapkan, link tertunda) — kini membawa hint rescue seperti 429 link/unlink (tunggu `retry_after_seconds`, coba ulang hanya langkah status, lalu re-link yang masih hilang setelah re-list).
- Paritas recipient manual (Harsh M7): event block/unblock manual (jalur status agent DAN update admin) kini memakai `depEventRecipients` (subscriber proyek + assignee), seperti event dependency — event block lama tidak menyebut recipient (broadcast-null, sehingga owner non-subscriber di proyek tertutup kelewatan lewat filter recipient) dan event unblock lama hanya menyebut assignee (subscriber kelewatan dengan cara yang sama). Poll sendiri juga menjangkau subscriber proyek; paritas ini untuk klien yang memfilter pada field recipients.
- Remainder sweep persisten (Domain M9): lihat koreksi definisi `pending_sweep` di atas (`pending_projects`/`failed_projects`).
- Refresh reason pada reopen dan delete (bug m-1): dependent waiting-task yang SUDAH blocked kini di-refresh reason-nya pada pass reopen (cabang baru sebelum filter todo/doing — tanpa perubahan status, tanpa hitungan processed, tanpa event) dan pada loop cascade delete untuk dependent dengan link tersisa (blocker yang dihapus keluar dari unfinished set lewat JOIN). Sebelumnya reason dependent yang sudah blocked mengabaikan blocker yang baru menjadi unfinished (reopen) atau menyebut blocker yang sudah dihapus (delete) sampai link/unlink/completion berikutnya. Test regresi reopen menegaskan reason menyebut A (lama) dan B (baru di-reopen).
- Presisi capped cascade delete (bug m-4): `capped` pada ringkasan cascade kini berarti ada snapshot RESTORABLE yang tersisa (blocked waiting-task, tidak archived, nol unfinished link), bukan sekadar "snapshot tersisa" — perilaku lama over-report bila semua sisa adalah waiting-human/archived/masih-link. Pemindaian sisa dibatasi window snapshot (<=500) dan himpunan unfinished stabil selama loop. Test regresi: 100 restorable + 5 waiting-human → `capped:false`, `pending_sweep:false`, `links_removed:105`, `dependents_unblocked:100`.
- Anchor unblocked admin (bug m-6): anchor dari proyek archived kini 400 juga untuk admin (sebelumnya diterima lalu terfilter menjadi halaman kosong, karena jalur admin melewati blok visibilitas yang memberi 404 pada agent).
- Claim 409 membawa blocked state (Harsh m-3): payload `current` pada 409 claim kini menyertakan `blocked_kind`/`blocked_reason`, sehingga caller tidak perlu satu panggilan detail (+1 token) untuk tahu kenapa task blocked.
- Yang TIDAK diputuskan ronde ini (tetap butuh kata Luki): semua item PIVOT dari ronde sebelumnya (body PROPOSE, kredensial Luki content-bound/single-use, enforcement hold, model konflik, flip cutover, hapus endorsement/blocklist, relabel advisory, stickiness, carve-out admin, surfacing stale-window, bentuk sheet/rescue/batch-wake/discovery, slimming, hapus recheck, threshold sweep, retensi audit, dissent, model lane, boundary ref-pointer, restore comment), plus minor yang dicatat tapi tidak diubah ronde ini: N+1/tanpa-batas pada daftar lain di luar search dan bare list proyek, beban siklus pada graf di bawah cap (masih O(E) per link, kini berbatas 1000 edge), tidak ada budget waktu/CPU alarm, offset tanpa batas pada `/available`/search (scan penuh pada offset besar), state rate-limit in-memory, penulisan `last_seen` per request (perilaku rev5), tidak ada observabilitas ukuran tabel audit, `pending_sweep` per panggilan yang tidak dipersisten (hanya remainder level sweep yang dipersisten), ejaan boolean query yang berbeda per endpoint, asimetri filter error (`field`/`allowed`) pada search, dan routing list-vs-search yang tetap trap (didokumentasikan, bukan diubah).

### 17.8 Fix round 7 (code-only, dari re-roast kelima)

- F1 — ban pesan test di jalur endorsement: `verifyEndorsement` kini menolak pesan test (channel `v5-seed-test` atau body mengandung `TEST ONLY`) pada KEDUA pesan — proposal maupun endorsement — dengan reason `endorsement_test_message`. Urutan tepatnya (dikoreksi fix round 8; kalimat ronde 7 "sebelum cek readability/match apa pun" terlalu luas): ban endorsement dulu, lalu `parseEndorse`, lalu `reply_missing` (wajib mendahului fetch — tanpa `reply_to` tidak ada proposal yang bisa dicek), lalu fetch proposal, lalu `proposal_not_found`, lalu ban proposal, lalu `title_mismatch` dan parse/match proposal. Jadi proposal test yang dipasangkan dengan endorsement ber-title-mismatch kini gagal dengan reason ban, bukan `title_mismatch`. Fix round 5 (M10) menutup lubang ini di seed/supersede/tombstone tetapi tidak pernah menyentuh fungsi ini, sehingga pasangan proposal+endorsement test (atau endorsement luki di `all-agent` dari channel test) bisa mengotorisasi row aksi nyata. Bukan bypass auth di produksi (sender di-stamp server dari bearer), tetapi ban yang tidak berlaku di satu jalur menggagalkan tujuan ban itu sendiri. Test regresi: endorsement channel test, proposal TEST ONLY, dan endorsement luki channel test — ketiganya 403 dengan reason tersebut.
- Boolean query diseragamkan (API M1): helper `parseBoolParam` di `utils.ts` — "1" dan "true" sama-sama true, "0"/"false" false, sisanya 400 (bukan filter diam-diam yang salah). Diterapkan ke search `global`/`include_archived`, summary `include_archived`, ledger `include_history`, dan comments `include_deleted`. Sebelumnya search/summary hanya membaca "1" (sehingga `?include_archived=true` diam-diam memfilter archived keluar) dan ledger/comments hanya membaca "true" (sehingga non-admin `?include_deleted=1` diam-diam melewatkan 403 yang dipicu "true", dan admin `?include_deleted=1` diam-diam me-list non-deleted saja). `stale` pada ronde ini masih 0/1-only dan tidak diubah (diseragamkan fix round 8, lihat §17.9).
- Anchor ledger vs filter (API M2): anchor list ledger kini harus memenuhi SEMUA filter request (status, kind, target_lane, ref_type, ref_id, jendela recheck_before, dan substring keyword bila ada) — bila tidak, 400 `anchor does not match filters`. Sebelumnya cursor yang dipakai ulang lintas perubahan filter diam-diam melewatkan row: query halaman adalah filter AND id > anchor, sehingga row sebelum anchor yang cocok dengan filter BARU tidak pernah muncul tanpa error. Caller yang mem-page satu list terfilter tidak berubah: setiap row halaman list itu sendiri memenuhi filter list itu.
- `target_lane` list divalidasi: typo pada `target_lane` kini 400, bukan halaman kosong yang tak terbedakan dari "tidak ada row". Nilai diterima bila menamai agent terdaftar ATAU nilai target_lane yang benar-benar ada pada row ledger (cabang kedua menjaga row yang ditargetkan ke agent yang sejak itu di-deregistrasi tetap bisa di-list). DIPERSEMPIT fix round 8 (lihat §17.9): cabang kedua kini admin-only, karena untuk non-admin ia adalah oracle keberadaan (string tak dikenal 400, sementara nama agent terdaftar lolos validasi lalu halaman kosong lewat filter visibilitas — 400-vs-200 membocorkan apakah nilai lane ada di mana pun).
- `recheck_before` masuk kontrak pager (API m-1): digit ketat + string "null" sebagai tidak ada, seperti pager lain — sebelumnya `parseInt` mengkoersi "12abc" menjadi 12 dan "null" menjadi NaN.
- Error search/project_id membawa field/allowed (API m-3): error filter search (status/blocked_kind/priority/lane/sort/due_date/stale/due_date_from/due_date_to), `global search is admin-only`, dan `project required` kini membawa `field` (dan `allowed` bila ada himpunan nilai); begitu pula error `project_id` di unblocked, summary, dan activity, error `lane`/`before`/`limit` di activity. Filter free-text (`assignee`/`label` search, `agent` activity) tidak punya himpunan nilai untuk di-allowed-kan, jadi tetap tanpa allowed — dicatat di sini, bukan diklaim sudah.
- Error link membawa field/hint (API m-10): self-link, cross-project, done-task, already-satisfied (409), dan duplicate (409) kini membawa `field` + `hint` seperti error not-found; hint already-satisfied secara eksplisit menyatakan "no link was stored", karena sebelumnya caller tidak diberi tahu bahwa link tidak pernah disimpan.
- Pointer kelanjutan ledger_refs (API m-5): payload detail kini membawa `ledger_refs_next_after_id` — id ref terakhir yang dikembalikan bila `has_more` true, null bila tidak — untuk dipakai sebagai `after_id` pada `GET /api/ledger?ref_type=task&ref_id=<taskId>` (urutan id ASC yang sama). Sebelumnya ref 21+ tidak terjangkau dari payload detail (workaround list ledger ada tetapi tidak ditunjuk di mana pun).
- Komentar poll-script diperbaiki (Harsh m-3): catatan revamp di `clients/do-inbox-poll.sh` salah di kedua arah — klaim "dependency changes do NOT wake this script" dan "UNVERIFIED" diganti dengan kebenaran yang sudah ada di SPEC §17.4: perubahan status yang digerakkan dependency MEMBANGUNKAN script (link row 1, re-block, unblock rule 4/4a, sinyal stuck — semuanya event `kanban.*` yang sudah cocok dengan filter script), sedangkan yang tetap tidak membangunkan adalah tulis ledger dan link/unlink yang tidak mengubah status. Perbaikan komentar saja; perilaku script tidak berubah.
- Penyebab fail-closed siklus dibedakan (Bug M1): `depHasCycle` kini mengembalikan `cause: 'edge_cap'` (graf >1000 edge) vs `cause: 'depth_cap'` (jalur >100 edge), dan 409 link membawa `cycle_cause` bila tidak ada path (bila ada path, hint jalur penutup tetap seperti sebelumnya). Sebelumnya kedua penyebab dirender dengan hint "100-edge depth cap", sehingga graf asiklik 1001 edge salah didiagnosis sebagai hit depth cap.
- Alasan orphan unlink diperbaiki (Bug M2): bila unlink terakhir pada row waiting-task manual/legacy (tanpa `blocked_from_status`) tidak bisa di-unblock oleh `depUnblockRow`, reason kini ditulis jujur sebagai "blocked with no unfinished links (orphan: ...)" — sebelumnya reason tetap menyebut link yang baru saja dihapus sementara row tetap blocked tanpa unfinished link. Sinyal skipped-unblock (system log + event poll) sudah menyala lewat `depUnblockRow` sendiri, jadi row ini terlihat; perbaikan ini hanya menghentikan mislabel-nya.
- Satu aturan refresh reason (Bug M3): jalur link-only kini memakai `depRefreshReason` yang sama seperti reopen/delete/completion — hanya row milik mesin (`blocked_from_status` todo/doing) yang mendapat reason mesin. Sebelumnya link-only me-refresh tanpa syarat untuk row blocked waiting-task apa pun, sehingga menambah link ke row MANUAL waiting-task menimpa reason yang diketik manusia dengan reason mesin, sementara jalur lain sengaja membiarkan reason manusia. Satu aturan di semua jalur sekarang: row manual mempertahankan reason manusianya saat link ditambahkan.
- Guard proyek archived di re-evaluasi (Bug M4): `depReevaluateProject` kini no-op dengan stats kosong bila proyeknya archived (atau tidak ada), bukan mengandalkan caller sepenuhnya. Sebelumnya SQL pass unblock tidak punya filter archived; kebenaran hanya bertumpu pada window sweep (`archived = 0`) dan urutan UPDATE-sebelum-reevaluasi pada unarchive — caller masa depan yang melewatkan proyek archived akan memutasinya.
- Split cursor-requires-limit DIDOKUMENTASIKAN, bukan diubah paksa (API m-9): dep list dan comments tetap mensyaratkan `limit` bila ada cursor (400 bila tidak), sedangkan ledger list/events, dep events, dan unblocked tetap membolehkan cursor saja dengan default 20. Split ini berprinsip, bukan sembarang: pager yang default tanpa-limit-nya unbounded (dep list full, comments full) mensyaratkan limit agar cursor tidak diam-diam mengembalikan full list; pager yang default-nya berbatas 20 tidak punya bahaya itu. Mengubah salah satu sisi akan memecah caller yang sudah benar (test cursor tanpa limit yang valid di ledger/unblocked, dan test 400 cursor-tanpa-limit di dep list/comments) — jadi aturannya dinyatakan di sini, bukan diseragamkan dengan memecah salah satunya. Split terkait yang juga dinyatakan: ejaan boolean kini seragam, tetapi `offset` tanpa `limit` tetap berbeda (`/available` 400, search default 200) dengan alasan yang sama seperti fix round 6 — `/available` tanpa limit unbounded sehingga offset saja tak bermakna.
- `filters.status` kini menggemakan "all" (bukan "") untuk list include_history tanpa param status — "" yang berarti "semua" sebelumnya hanya bisa ditebak, tidak dinyatakan.
- Activity pager masuk kontrak (cheap): `limit=null` kini diperlakukan sebagai tidak ada (sebelumnya 400, sementara setiap pager lain memperlakukannya sebagai tidak ada); error `before`/`limit`/`project_id`/`lane` activity membawa `field` (+ `allowed` untuk lane).
- Yang TIDAK diputuskan ronde ini (tetap butuh kata Luki): semua item PIVOT dari ronde sebelumnya (body PROPOSE, kredensial Luki content-bound/single-use, enforcement hold, model konflik, flip cutover, hapus endorsement/blocklist, relabel advisory, stickiness, carve-out admin, surfacing stale-window, bentuk sheet/rescue/batch-wake/discovery, slimming, hapus recheck, threshold sweep, retensi audit, dissent, model lane, boundary ref-pointer, restore comment), plus deviasi plan §4 re-claim (preservasi `unblocked_at` pada re-claim already-owned vs blanket "claim clears" — amend §4 atau revert, diputuskan Luki, tidak disentuh ronde ini).

### 17.9 Fix round 8 (code-only, dari re-roast keenam)

- Urutan ban proposal (item 1, CODE MOVE, bukan sekadar penyempitan kalimat): `verifyEndorsement` kini memeriksa ban endorsement dulu, lalu `parseEndorse`, lalu `reply_missing`, lalu fetch proposal, lalu `proposal_not_found`, lalu ban proposal, lalu `title_mismatch` dan parse/match proposal. `reply_missing` terpaksa mendahului fetch (tanpa `reply_to` tidak ada proposal yang bisa dicek); yang dipindah adalah ban proposal — dari sesudah `title_mismatch`/`reply_missing`/`proposal_not_found` menjadi sebelum `title_mismatch` dan sebelum parse/match proposal. Kalimat §17.8 dikoreksi ke urutan tepat ini. Test regresi: proposal TEST ONLY + endorsement ber-title-mismatch kini 403 `endorsement_test_message`, bukan `title_mismatch`.
- Summary `include_archived` di-hoist (item 2): spelling kini divalidasi di atas branch proyek di `handleKbSummary`, sehingga nilai sampah 400 baik tanpa proyek, dengan `project_id` admin, maupun lewat path proyek non-admin. Nilai yang di-parse tetap hanya dikonsumsi branch admin tanpa proyek; hoist ini hanya soal 400 yang konsisten, bukan soal branch mana yang memakai nilainya.
- Boolean unification leftovers (item 3): search `stale` kini memakai `parseBoolParam` ("1"/"true" true, "0"/"false" false, sisanya 400 dengan `field: 'stale'` + `allowed`) — sebelumnya hanya 0/1, sehingga `?stale=true` 400 di endpoint yang sama tempat `?global=true` bekerja. Poll `admin` kini memakai `parseBoolParam` juga (absen = false, spelling tak dikenal 400 `invalid admin` dengan field + allowed) — sebelumnya hanya "1" yang berarti admin, sehingga `?admin=true` diam-diam menjalankan jalur agent. Tidak ada spelling yang sebelumnya true yang berubah menjadi false; yang berubah hanya spelling yang sebelumnya diam-diam salah menjadi 400 yang keras.
- Field pada error link (item 4): error proyek archived kini membawa `field: 'project_id'` (sebelumnya hanya hint), dan 409 siklus kini membawa `field: 'blocker_id'` (sebelumnya hanya `cycle_path`/`cycle_cause`/hint). Perilaku penolakan tidak berubah; hanya kelengkapan field-nya.
- Claim 409 + blocker_ids terstruktur (item 5): payload `current` pada 409 claim kini membawa `blocked_from_status` (seperti ketiga jalur 200 claim) DAN `blocker_ids` — id dependency yang masih unfinished, dibaca dari row dependency lewat `depUnfinishedBlockers`, bukan dari prosa `blocked_reason` yang dipotong 500 karakter. Claim 200 atas task blocked juga membawa `blocker_ids` yang sama. DUA non-perubahan yang disengaja, dinyatakan di sini: (a) claim 200 todo→doing TIDAK membawa `blocker_ids` — task-nya doing, bukan blocked, dan daftar blocker di situ akan basi pada perubahan status (sumber terstrukturnya tetap dep list); (b) blok re-claim already-owned TIDAK disentuh sama sekali — aturan preservasi `unblocked_at`-nya masih menunggu kata Luki (lihat §17.6), dan ronde ini tidak mengubah satu baris pun di jalurnya.
- Gate hint orphan-aware (item 6): `depGateManualStatus` kini membedakan row waiting-task yang dimiliki mesin (`blocked_from_status` todo/doing) dari row orphan mesin (`blocked_from_status` NULL). Row orphan mendapat hint "this waiting-task block is orphaned (no blocked_from_status), so blocker completion never lifts it; unlink all unfinished links first, then manually move the task" — bukan lagi "finish or unlink the blocking tasks first" yang menjanjikan "finish" padahal `depUnblockRow` mengembalikan null untuk row orphan dan hanya sinyal skipped-unblock yang menyala. Kondisi orphan di gate sama persis dengan kondisi null di `depUnblockRow`. Hint waiting-human/waiting-external dan waiting-task yang dimiliki tidak berubah.
- `target_lane` oracle dipersempit (item 7, NARROWING, bukan sekadar dokumentasi): cabang validasi kedua (nilai target_lane yang ada pada row ledger) kini admin-only. Untuk non-admin, cabang itu adalah oracle keberadaan: string tak dikenal 400, sementara nama agent terdaftar lolos validasi lalu halaman kosong lewat filter visibilitas — 400-vs-200 membocorkan apakah nilai lane ada di mana pun. Non-admin tidak kehilangan apa-apa dalam praktik: filter list-nya sendiri sudah membatasi ke `(target_lane IS NULL OR target_lane = nama sendiri)`, dan nama sendiri lolos cabang agent terdaftar. Admin mempertahankan listabilitas target deregistrasi yang menjadi alasan cabang kedua ditambahkan. Catatan residual: untuk admin, typo yang mendarat tepat pada nama agent deregistrasi tetap lolos validasi dan mengembalikan row agent itu — tidak terbedakan dari query yang benar; itu harga dari listabilitas deregistrasi, dan hanya berlaku untuk admin.
- Satu tabel split 400/404 (item 8, DOKUMENTASI SAJA — tidak ada perilaku kode yang diubah item ini):

  | Endpoint | Anchor tidak ada (id tak dikenal) | Anchor ada tapi di luar predikat/filter | Anchor ada tapi tak terlihat caller (visibilitas) |
  |---|---|---|---|
  | Dep list (`blockers_after_id`/`blocked_by_after_id`, legacy `after_id`) | 404 `task not found` (per-list; legacy `after_id` yang tidak ada di kedua list 404) | — (cursor per-list bukan anchor row terfilter) | 404 yang sama (visibilitas = task tak ditemukan) |
  | Dep events (`after_id`) | Halaman kosong, `has_more: false` — BUKAN error (filter `id >` telanjang atas tabel append-only) | — | — |
  | Unblocked (`after_id`) | 400 `invalid after_id` (termasuk anchor yang `unblocked_at`-nya sudah dibersihkan) | 400: status bukan todo, project salah, anchor admin dari proyek archived | 404 `task not found` (archived, tak berlangganan, atau milik agent lain — agent saja) |
  | Ledger list (`after_id`) | 400 `invalid after_id` | 400 `anchor does not match filters` (status/kind/target_lane/ref_type/ref_id/jendela recheck/keyword; sejak fix round 8 membawa `field: 'after_id'` + hint restart-from-0) | 404 `ledger row not found` (lane-invisible, non-admin saja) |
  | Comments (`after_id`) | Halaman kosong, `has_more: false` — BUKAN error (seperti dep events: tabel append-only, filter `id >` telanjang) | — | — |

  Prinsip di balik split ini: pager atas row yang bisa berubah/hilang (dep list, unblocked, ledger) memperlakukan anchor basi sebagai error; pager atas tabel append-only (dep events, comments) memperlakukan id basi sebagai "sudah catch-up". Kalimat §17.2 yang menyebut unblocked luar-predikat 404 dikoreksi ke tabel ini.
- Activity null (item 9): `before=null` dan `project_id=null` (admin) kini diperlakukan sebagai tidak ada, seperti `limit=null` di handler yang sama dan `project_id=null` di unblocked. Satu handler, satu aturan "null". `before=12abc` tetap 400; validasi digit ketat tidak dilonggarkan, hanya string "null" yang menjadi absent.
- Kalimat §17.6 unknown-field dikoreksi (item 10): lihat koreksi di §17.6 — dep link + keluarga ledger/tombstone + agent task update menolak unknown field 400; status PUT (agent + admin) tanpa allowlist dan diam-diam membuang field tak dikenal; loudness yang tidak konsisten di dua PUT pada task yang sama adalah pilihan desain yang didokumentasikan, perilaku tidak berubah.
- Edge_cap tidak lagi menutupi path (item 11, CODE FIX, bukan sekadar dokumentasi): `depHasCycle` tidak lagi mengembalikan `edge_cap` sebelum BFS. Trunkasi hanya bisa menyembunyikan path, tidak pernah memfabrikasi satu pun (setiap edge yang ter-load adalah edge nyata) — jadi path penutup yang ditemukan di himpunan terpotong adalah siklus nyata dan dikembalikan beserta path-nya, bahkan pada graf >1000 edge. Hanya bila tidak ada path yang ditemukan cap gagal tertutup (`edge_cap` bila edge > 1000, `depth_cap` bila terpotong). Jaminan fail-closed utuh: tidak ada path tetap 409. Test regresi: 1001 filler edge + satu 2-cycle di proyek yang sama → `cycle: true` dengan path non-empty, bukan `edge_cap` + path kosong.
- Tulis orphan lewat refresh guard (item 12, GUARD-WITH-EXCEPTION, bukan sekadar dokumentasi): `depRefreshReason` kini menerima `opts.orphan`. Tanpa opts, perilaku semua caller lama tidak berubah (unfinished > 0 + row milik mesin → tulis multi-reason; unfinished > 0 + row manual → no-op; nol unfinished → no-op). Dengan `opts.orphan`, row blocked waiting-task tanpa `blocked_from_status` dan nol unfinished link mendapat teks orphan yang jujur. Cabang unlink kini me-routing kasus orphan nol-unfinished itu lewat guard (dan membaca ulang reason lewat `depGetTask`), bukan UPDATE langsung; cabang unfinished > 0 byte-identik perilakunya. Pengecualian ini didokumentasikan di kode sebagai SATU pengecualian yang disengaja di dalam guard, bukan situs UPDATE ad-hoc kedua — sehingga aturan "satu refresh rule" tetap satu fungsi, dengan pengecualian orphan yang eksplisit di dalamnya. Test regresi: row manual mempertahankan reason manusia saat link, dan unlink link terakhirnya tetap mendaratkan teks orphan.
- Perangkap harsh-user (a) — pagination ledger di bawah supersede konkuren: 400 `anchor does not match filters` kini membawa `field: 'after_id'` + hint "the anchor row changed (e.g. superseded) or the filters changed since page 1; re-list from the start with no after_id to resume paging". 400-nya sendiri TIDAK berubah — yang berubah hanya failure-nya menjadi actionable: caller tahu harus restart dari 0, bukan menebak kenapa cursor-nya ditolak. Ini mitigasi, bukan perbaikan bentuk: pagination di bawah write konkuren tetap rapuh oleh desain (anchor adalah row yang bisa berubah status), dan filter sejak/changed tetap tidak dibangun ronde ini (keputusan bentuk milik Luki).
- Perangkap harsh-user (b) — replay cursor "null": aturan "null"-as-absent TIDAK di-revert. Yang didokumentasikan di sini adalah perilaku replay-nya: paging dengan `?after_id=null` (atau cursor per-list `=null`) sama dengan tidak mengirim cursor sama sekali — restart dari halaman 1. Dep list tanpa limit + cursor NYATA tetap 400 — tetapi dep list tanpa limit + cursor `"null"` TIDAK 400: `parseCursor` memetakan `"null"` ke absent SEBELUM cek limit-required, sehingga `"null"` bukan cursor sama sekali dan panggilan itu mengembalikan full list tanpa limit (200), sama seperti tidak mengirim cursor. Kalimat §17.9 lama yang menyebut "cursor tanpa limit ditolak sebelum aturan null berlaku" adalah SALAH untuk cursor null (benar hanya untuk cursor nyata); dikoreksi di sini dan di §17.10. Dep list dengan limit + cursor `"null"` me-replay halaman 1 secara diam-diam; pager default-20 (ledger, unblocked, dep events) me-replay halaman 1 secara diam-diam; comments tanpa limit + `after_id=null` juga mengembalikan full list. Perilaku "null"-as-absent sendiri TIDAK diubah — itu pertanyaan bentuk milik Luki. Caller scripted TIDAK BOLEH meng-echo `next_after_id: null` sebagai cursor — hilangkan paramnya untuk restart yang disengaja, atau kirim cursor non-null yang nyata untuk halaman berikutnya. Replay ini terlihat seperti sukses (200 + halaman 1), itulah kenapa ia didokumentasikan secara eksplisit, bukan dibiarkan sebagai perilaku implisit dari parseCursor.
- Split yang TETAP didokumentasikan, bukan diseragamkan paksa: cursor-requires-limit (dep list/comments mensyaratkan limit dengan cursor; pager default-20 tidak) dan offset-tanpa-limit (`/available` 400 vs search default 200) tetap seperti §17.8 — keduanya berprinsip unbounded-vs-bounded, dan menyeragamkan salah satu sisi akan memecah caller yang sudah benar.
- Yang TIDAK diputuskan ronde ini (tetap butuh kata Luki): semua item PIVOT dari ronde sebelumnya (body PROPOSE, kredensial Luki content-bound/single-use, enforcement hold, model konflik, flip cutover, hapus endorsement/blocklist, relabel advisory, stickiness, carve-out admin, surfacing stale-window, bentuk sheet di luar field di atas, bentuk rescue, batch wake / read bucket, discovery endpoint, slimming, hapus recheck, threshold sweep, retensi audit, dissent, model lane, boundary ref-pointer, restore comment, token-bucket relief, filter ledger since/changed, perubahan predikat stale, enforcement deadline recheck), plus deviasi plan §4 re-claim (preservasi `unblocked_at` pada re-claim already-owned vs blanket "claim clears" — amend §4 atau revert, diputuskan Luki, tidak disentuh ronde ini). KILL grounds harsh-user (no wake/discovery, token math, freeing-blocker field di unblocked, predikat stale, flagging deadline recheck) adalah pertanyaan bentuk, BUKAN bug kode yang diperbaiki ronde ini — semuanya dibiarkan untuk kata Luki.

### 17.10 Fix round 9 (code-only, dari re-roast ketujuh)

- Unlink unfinished>0 lewat guard (item 1, CODE FIX — syarat suara bug-hunter): cabang unlink `handleDepUnlink` yang masih punya unfinished link dulu menulis `depMultiReason` langsung tanpa cek `blocked_from_status`, sehingga row waiting-task manual (reason tulisan manusia, `blocked_from_status` NULL) dengan >=2 link kehilangan reason manusianya secara diam-diam saat satu link di-unlink — dan tidak ada log reason lama (event unlink membawa `reason: null`). Cabang itu kini me-routing lewat `depRefreshReason`: row milik mesin di-refresh ke himpunan tersisa persis seperti sebelumnya, row manual no-op dan mempertahankan reason-nya. Sejak ronde ini TIDAK ADA lagi UPDATE reason langsung di jalur unlink — semua cabang (unfinished>0, orphan nol-unfinished) lewat guard. Biaya: satu query `depUnfinishedBlockers` terindeks ekstra di dalam guard pada jalur single-row. Test regresi: row manual dengan 2 unfinished link, unlink satu → 200, `unlink_only`, reason tetap tulisan manusia; row mesin dengan 2 link, unlink satu → reason di-refresh ke himpunan tersisa.
- Koreksi SPEC cursor null (item 2, DOKUMENTASI SAJA — perilaku TIDAK diubah): verifikasi ulang terhadap kode semua pager membuktikan kalimat §17.9 lama salah untuk cursor null. Aturan yang benar, per pager: dep list (`parseCursor`, `dependencies.ts`): `"null"` → absent sebelum cek limit-required, jadi tanpa limit + `after_id=null` = full list 200 (bukan 400), dengan limit = replay halaman 1 diam-diam; ledger list: `"null"` → absent, default limit 20 → replay halaman 1; dep events: `"null"` → id 0, default limit 20 → replay halaman 1; unblocked: `"null"` → absent, default limit 20 → replay halaman 1; comments: `"null"` → absent, dan cek limit-required hanya menyala bila after non-null, jadi tanpa limit + `after_id=null` = full list 200; `/available`/search: `"null"` → absent untuk limit maupun offset, sehingga offset 0 + tanpa limit = full set (dengan `has_more: false` yang tetap menyesatkan di set besar — sudah dicatat sebelumnya). Aturan "null"-as-absent dipertahankan apa adanya; mengubahnya menjadi 400 adalah pertanyaan bentuk milik Luki, bukan perbaikan ronde ini.
- Blind write pada row ledger yang ditargetkan (item 3, DOKUMENTASI SAJA — TIDAK ada perubahan kode, dengan alasan): supersede/tombstone non-admin memang hanya memeriksa authorship (`old.author === actor`), bukan `ledgerRowVisible` — jadi author sebuah row yang ditargetkan ke lane lain (row yang GET/list-nya 404 untuk author itu sendiri) tetap bisa men-supersede/men-tombstone row tersebut. Menambahkan gate visibilitas TIDAK dilakukan dengan sengaja: gate itu akan memblokir tepat kasus author-targeted, sehingga author tidak pernah lagi bisa men-supersede/men-tombstone row buatannya sendiri yang ditargetkan ke lane lain — hanya admin yang bisa — dan itu kerusakan workflow yang lebih besar daripada edge blind-write-nya, karena author adalah pembuat row itu, tulisannya teraudit (`ledger_events` + `superseded_by_id`/`tombstoned_by`), dan tidak ada kebocoran konten (author sudah tahu isi awal row-nya). Targeting melindungi pembacaan, bukan kepemilikan tulis; itu kini dinyatakan eksplisit sebagai batasan yang diketahui, bukan bug yang tertinggal.
- Tombstone reason tanpa cap (item 4, DOKUMENTASI SAJA): reason tombstone tetap hanya di-trim + dicek blocklist, tanpa cap karakter seperti title (200 char, 413) / body (8192 byte, 413). Diputuskan didokumentasikan, bukan di-cap, karena angka cap-nya sendiri adalah kebijakan (bukan perbaikan trivial): reason adalah penjelasan manusia yang juga mengalir ke `ledger_events.reason` (dengan suffix kredensial), dan backstop-nya adalah batas row SQLite 2 MB — reason multi-ratus-KB akan 500 pada insert, bukan korupsi diam-diam. Bila Luki menginginkan cap, nilainya diputuskan dia, bukan ronde ini.
- Semantik `seed_exception_uses.ledger_id` (item 4, DOKUMENTASI SAJA): kolom yang sama berarti dua hal menurut jalur yang mengonsumsinya — pada supersede ia mencatat id row BARU (successor, `newId`), pada tombstone ia mencatat id row yang DI-TOMBSTONE (`old.id`). Single-use tetap ditegakkan oleh PRIMARY KEY atas `lock_decision_ref` itu sendiri di kedua jalur, jadi perbedaan ini hanya soal audit, bukan soal bypass; pembaca audit harus menafsirkan `ledger_id` bersama `action` di `ledger_events`.
- Komentar `depUnblockRow` tentang `unblocked_at` TIDAK disentuh sama sekali (dilarang sampai deviasi §4 re-claim diputuskan Luki) — komentar itu masih menyebut aturan lama yang bertentangan dengan deviasi, dan akan diperbarui mengikuti arah mana pun yang Luki pilih.
- Yang TIDAK diputuskan ronde ini (tetap butuh kata Luki): semua item PIVOT (termasuk apakah supersede diam-diam membersihkan `recheck_at` saat di-omit — M2 bug-hunter, diparkir sebagai pertanyaan arah), deviasi plan §4 re-claim, dan KILL grounds harsh-user (no wake/discovery, token math, bentuk rescue, field freeing-blocker, predikat stale, flagging deadline recheck). M2–M5 bug-hunter lainnya (stamp completion alarm, `catch {}` detail, oracle lane terdaftar, reason tombstone, semantik seed_exception_uses) ditangani sebagai didokumentasikan-di-§17.10 ini atau sudah dicatat sebelumnya, bukan diperbaiki diam-diam sebagai kode.

### 17.11 Amendment batch (keputusan Luki 2026-11-03, jalur konsisten penuh dan mekanis)

Semua item di bawah diputuskan Luki 2026-11-03 05:32 WIB sebagai satu
batch ("jalur konsisten penuh dan mekanis"), setelah 05:27 WIB beliau
memerintahkan item PIVOT yang menentang lock untuk di-skip. Yang
di-skip dan TIDAK dibangun: perubahan protokol endorsement ke
body-sight, kredensial Luki content-bound, penghapusan
endorsement/blocklist, relabel advisory untuk hold/gate, penghapusan
admin carve-out, slimming/dumb ledger, penghapusan recheck, dan
redesain unifikasi cursor. Yang ditutup ronde ini (sebelumnya
"belum diputuskan" di §17.6–§17.10): deviasi §4 re-claim, enforcement
hold, model konflik, cutover, stickiness, stale/recheck surfacing,
bentuk sheet, rescue atomik, wake + bucket, discovery, threshold
sweep, retensi audit, efek dissent, cleanup deregistrasi, scan
ref-pointer, restore comment, cursor nyata, detail fan-out delete,
dan visibilitas pending-sweep. Catatan ronde lama yang menyebut
item-item ini "tidak dibangun / tidak diputuskan" (mis. rescue
2N+1 di §17.6 M4, cursor offset di §17.6 M5, "filter sejak/changed
tidak dibangun" di §17.9) kini SUPERSEDED oleh bagian ini — perilaku
baru di bawah yang berlaku, bukan kalimat lama itu.

- Item 0 — §4 REVERT (blanket-clear, tanpa pengecualian). Cabang
  re-claim already-owned di `handlers/kanban.ts` kini menjalankan
  `UPDATE tasks SET unblocked_at = NULL` dalam `transactionSync`
  yang sama, persis seperti claim segar; blok round-5 yang
  menyatakan "PRESERVES / No UPDATE here by design" dihapus.
  Response tidak berubah (`already: true`). Konsekuensi yang
  dinyatakan eksplisit: anchor trap unblocked list kini berlaku
  untuk KEDUA jenis claim — re-claim already-owned juga
  membersihkan stamp, sehingga `after_id` lama 400 dan caller
  harus restart dari 0. Yang TIDAK berubah: release todo tanpa
  perubahan status tetap mempertahankan `unblocked_at` (fix round
  4 item 7 — itu release, bukan claim), dan PUT status same-status
  tetap mempertahankannya. Test: `batch-a.test.ts` (re-claim
  owned → stamp NULL + keluar dari unblocked list; claim segar
  tetap membersihkan).

- Item 1 — Mechanical hold enforcement. Helper bersama
  `kbHoldRejection(bus, taskId)` (`handlers/kanban.ts`): cek ledger
  hold/gate aktif dulu (`taskHoldFor`: row kind hold/gate,
  ref_type task, ref_id = id task), lalu dissent hold
  (`dissentHoldFor('task', String(id))`); salah satu held → 409
  `{error: 'held', ledger_id}` atau `{error: 'dissent_held',
  dissent_id}` + hint, TANPA mutasi. Jalur yang ditegakkan:
  claim agent (dicek SEBELUM early-return already-owned, sehingga
  re-claim held juga 409, bukan `already: true`); status PUT
  agent (di dalam transaction, setelah auto-claim/visibilitas,
  throw `TxAbort` sehingga auto-claim yang baru diterapkan ikut
  rollback); status PUT admin (setelah validasi, sebelum
  transaksi, hanya bila field status ada — termasuk same-status
  PUT dan `unblock: true` — atau assignee benar-benar berubah;
  edit judul/notes/comment-only admin pada task held tetap
  diizinkan); perubahan assignee admin; handoff lane pada PUT
  umum agent (`handlers/kanban-expansion.ts`: handoff me-reassign,
  sehingga dicek juga — 409, rollback penuh). Admin TIDAK exempt
  di jalur mana pun. Yang TIDAK ditegakkan, dinyatakan eksplisit:
  PUT umum agent selain handoff (lane/notes/due_date pada task
  sendiri tanpa reassign) tidak dicek — itu edit, bukan
  assignment. Rescue (item 12) sengaja tidak di-hold-check:
  daftar jalur item 1 adalah status/claim/assign; menambahkan
  cek ke rescue adalah penambahan 3 baris bila Luki
  menginginkannya nanti. Test: `batch-a.test.ts` (held status
  409 + tak berubah; held claim 409 + tetap unassigned; held
  re-claim already-owned 409; dissent-held 409 dengan
  `dissent_id`; admin status/assignee pada held 409; row kind
  gate juga menahan) dan `batch-wave2.test.ts` (handoff held
  409 + tak berubah; setelah hold di-tombstone, handoff 200 +
  reassign ke lane owner).

- Item 2 — Full conflict model (migrasi v9). (a) `topic`: wajib
  pada create/seed untuk kind decision/hold/gate (kosong → 400,
  >200 char → 413), opsional untuk kind lain; supersede
  mewarisi bila di-omit. Alasan wajib-hanya-tiga-kind:
  decision/hold/gate adalah row yang bisa dikontradiksi dan
  perlu resolver; kind lain (protocol/handover/dead-end/dissent)
  tidak punya topik yang bisa di-resolve. (b) Kontradiksi:
  `POST /api/ledger/:id/contradiction` (+ varian admin),
  tabel `ledger_contradictions` dengan UNIQUE pair; row sendiri
  → 400, target hilang → 404, duplikat → 409; list/detail
  menampilkan `has_contradiction`, `contradicts_ids`,
  `contradicted_by_ids`, `contradicting_ids` (union), lewat satu
  bulk query per halaman list. Aturan own-row hanya untuk
  agent, bukan admin (judgement call, didokumentasikan).
  (c) Resolver: kolom `resolver`, di-set pada create/seed dan
  lewat `POST /:id/resolver` (author atau admin, selain itu
  403; harus agent terdaftar atau `'admin'`, selain itu 400;
  null eksplisit menghapus). (d) Single-successor: create dan
  seed replacement yang menarget row yang SUDAH punya successor
  AKTIF → 409; guard memeriksa successor aktif saja (lineage
  berlanjut lewat rantai supersede successor itu). Linearitas
  rantai supersede sudah dijamin cek active-only yang lama,
  diverifikasi bukan diduplikasi. Test: `batch-b.test.ts`.

- Item 3 — Cutover machine state (kontrak dikunci SEKARANG,
  eksekusi seed tetap ditunda). `bus_meta 'authority_state'`
  (`memory_authoritative` default bila absent/tak dikenal, atau
  `bus_authoritative`) dan `bus_meta 'seed_checklist'` JSON
  `{items: [{id, title, state}]}` yang mulai KOSONG.
  `GET /api/cutover` (agent Bearer, bucket read) dan
  `GET /admin/api/cutover` (admin Basic) mengembalikan
  `{authority_state, seed_checklist}`. `POST
  /admin/api/cutover/flip {authority_state}` memvalidasi nilai
  (selain itu 400), menulis `bus_meta`, menambah log audit
  `cutover_flips` (cap 50 entri), meng-emit event poll
  `cutover.flipped` best-effort, dan mengembalikan
  `{ok, previous, authority_state}`. `POST
  /admin/api/cutover/checklist {id?, title}` menambah item
  `pending` (state kiriman klien diabaikan, id duplikat → 409).
  TIDAK ADA seed row yang di-insert di mana pun — append
  checklist hanya menyentuh `bus_meta`. Prosedur flip
  (admin-only, didokumentasikan di kode): rekonsiliasi di
  MEMORY.md dulu, flip, verifikasi lewat GET, flip balik
  simetris; seeding tetap ditunda sampai kata Luki (#28).
  Pilihan audit: `ledger_events` sengaja TIDAK dipakai untuk
  flip — CHECK action-nya (create/supersede/tombstone/seed/
  demote) dan FK `ledger_id`-nya tidak cocok untuk flip
  machine-state. Reads WAJIB menampilkan authority state saat
  ini — endpoint GET di atas adalah caranya. TIDAK ADA
  endpoint mark-done untuk checklist (tidak dispesifikasi;
  shape `state` sudah ada untuk langkah berikutnya). Test:
  `batch-c.test.ts` (default, flip 401/400/200 bolak-balik,
  checklist append + duplikat 409 + ledger count tak berubah).

- Item 4 — Sticky protection. Supersede menghapus hardcoded
  `is_luki_ordered=0`: successor row `luki_ordered` tetap
  `luki_ordered` (flag 1, provenance `'luki_ordered'`); kredensial
  Luki segar pada supersede berikutnya me-reaffirm, bukan
  meng-override. Tidak ada perubahan cek: `isProtected`
  mengunci pada flag/provenance yang sama, sehingga supersede/
  tombstone BERIKUTNYA atas successor tetap menuntut kredensial
  yang sama. Perilaku successor `lock_ordered` dipertahankan
  apa adanya. TIDAK dibangun: kredensial Luki single-use
  (di-skip). Test: `batch-b.test.ts` (rantai: seed →
  supersede Luki tetap ordered → tanpa kredensial 403 →
  supersede berkredensial tetap ordered → tombstone 403
  tanpa / 200 dengan kredensial).

- Item 5 — Stale/recheck surfacing. (a) Row lewat `recheck_at`
  menampilkan flag `stale` (= `recheck_at <= now`) pada GET
  tunggal DAN list, dibedakan dari field lama
  `recheck_overdue` yang dipertahankan tak tersentuh.
  (b) Supersede yang meng-omit `recheck_at` MEWARISI nilai lama
  (tidak pernah diam-diam clear); null eksplisit adalah clear
  eksplisit dan menambah `recheck_at_cleared:explicit_null`
  pada reason audit supersede. Ini MENUTUP bug-hunter M2
  (supersede diam-diam membersihkan `recheck_at`).
  (c) Deadline Q8 (`demote_deadline`, kolom yang sudah ada —
  tidak diciptakan kolom deadline kedua) ditampilkan sebagai
  due date aktif: GET tunggal membawa
  `recheck_deadline_overdue` (now > deadline), list membawa
  flag deadline-overdue yang sama. Test: `batch-b.test.ts`
  (stale GET+list, inherit vs null-eksplisit + catatan audit,
  deadline overdue true/false GET+list).

- Item 6 — Sheet shape. `/available` mendapat `?status=`
  (hanya todo|blocked, selain itu 400) dan
  `?exclude_blocked=` (`parseBoolParam`; true memaksa todo;
  dikombinasi dengan `status=blocked` → 400). Task detail
  mendapat field dependency penuh: blockers membawa
  `blocked_kind`, `blocked_reason` (dari row blocker itu
  sendiri), dan `unfinished` (status != 'done') per blocker;
  `blocked_by` membawa `unfinished` per dependent.
  `ledger_refs` di detail membawa `provenance_type` dan
  `body_excerpt` (potong 200 char, sama seperti
  `body_truncated` di list ledger), dan di-page dari detail
  itu sendiri lewat `?ledger_refs_after_id=` (digit ketat,
  `"null"` = absent, selain itu 400) — bukan hanya pointer
  ke list ledger. Test: `batch-wave2.test.ts`.

- Item 7 — Atomic rescue endpoint. `POST
  /api/kanban/tasks/:id/rescue` dan varian admin
  (`handlers/kanban.ts` `handleKbTaskRescue`): SATU
  `transactionSync` yang melakukan unlink semua link
  UNFINISHED saat ini (link blocker done dipertahankan) dengan
  satu baris `dependency_events` unlink per link → gate
  dependency pada row pasca-unlink → status move (field
  blocked dibersihkan; move same-status/no-op mempertahankan
  `unblocked_at`, mencerminkan aturan fix round 4 item 7)
  dengan event `kanban.task.unblocked`/`updated` + system log
  → fan-out done/reopen parity (`depReevaluateOnDone`/
  `depReblockOnReopen`, ditampilkan sebagai
  `dependency_fanout`) → loop re-link, tiap entri divalidasi
  dengan `depLinkCheck` yang sama persis (termasuk cek
  siklus) lewat `depApplyLink` yang diekstrak dari
  `handleDepLink`. Satu `rlCheck` untuk agent (satu unit
  rate), admin exempt; semua validasi (unknown-field 400,
  enum status, `relink` array integer, 404/403
  visibilitas/kepemilikan, archived 400) SEBELUM rate check.
  Response: `{ok, id, status, target_status, unlinked: [...],
  relinked: [{blocker_id, ok, skipped?}], relink_failed:
  [{blocker_id, error}], dependency_fanout?}`; re-link
  yang sudah terpenuhi (blocker done) atau duplikat masuk
  `relinked` dengan `ok: true, skipped:
  'already-satisfied'|'duplicate link'` (bukan failed);
  kegagalan validasi nyata masuk `relink_failed` hanya untuk
  link itu. Retry idempotent by construction. DUA semantik
  yang dinyatakan eksplisit: (1) re-link memakai transisi
  link normal (`depApplyLink`), sehingga re-link blocker
  unfinished ke task todo/doing mem-block-nya kembali
  waiting-task — `status` response adalah status AKHIR
  pasca-re-link, `target_status` membawa move yang diminta;
  rescue dengan `relink: []` (atau hanya entri skipped)
  mendarat tepat di `target_status`; re-link "link-only"
  (task tetap di target meski memegang link unfinished)
  akan melanggar invarian machine-ownership, sehingga TIDAK
  dibangun. (2) Target rescue `blocked` adalah 400 (body
  tidak membawa kind/reason untuk membangun block).
  Urutan 2N+1 lama tetap didokumentasikan sebagai legacy.
  Wake: link-only meng-emit
  `kanban.task.dependency_changed` `{change: 'linked'}`,
  unlink-only `{change: 'unlinked'}`; kasus transisi sudah
  wake lewat blocked/unblocked dan tidak di-emit ganda.
  Test: `batch-a.test.ts`.

- Item 8 — Wake + buckets. (a) `GET /api/wake`: tepat SATU
  unit bucket read (satu `rlCheckRead`; `?since` tak valid
  400 SEBELUM charge, sesuai konvensi validate-before-rate).
  Mengembalikan tepat `{holds, unblocked, tasks,
  ledger_changed}`: holds = row hold/gate aktif yang terlihat
  caller (aturan visibilitas sama dengan list ledger, dengan
  mapping presentasi `demote_*`→`recheck_*`); unblocked =
  task caller dengan `unblocked_at` set, terbaru dulu, maks
  20, proyek non-archived; tasks = task assigned todo/doing/
  blocked caller PLUS set `/available` (WHERE yang sama,
  maks 100); `ledger_changed` = row terlihat caller dari
  status apa pun (tombstone adalah change), id DESC — dengan
  `?since` (ISO, di-floor ke detik epoch karena timestamp
  ledger berdetik) `updated_at >= since` maks 100, tanpa itu
  20 terbaru. (b) List ledger mendapat `?since=<ISO>`
  (filter `updated_at > since`, mencakup created-or-updated
  karena `updated_at` di-bump tiap write) dan
  `?changed_after_id=<id>` (cursor id row, `id >` itu, tanpa
  validasi anchor-match sehingga berkomposisi dengan filter);
  keduanya 400 pada input buruk dan termasuk dalam cek
  anchor-match. (c) `ledger.changed` poll event
  (`{ledger_id, action}`, scope `'all'`) kini di-emit setelah
  create, supersede, tombstone, seed, contradiction,
  resolver, dan resolve-dissent — `handlers/ledger.ts` tidak
  lagi nol `emitEvent`. Pengecualian yang disengaja:
  recheck-assignment TIDAK meng-emit, karena semantik
  lock-nya recording-only ("no wake or message sent") — wake
  di sana akan menentang lock. Link/unlink-only juga wake
  (lihat item 7). (d) Bucket TERPISAH read vs write:
  `rlCheckRead`/`rlCheckWrite` di `handlers/agents.ts`,
  kunci `read:<agent>`/`write:<agent>` di Map `rateLimit`;
  `rlCheck` dipertahankan sebagai alias bucket write; batas
  angka TIDAK berubah (10/60 detik default, 10/3600 detik
  wren), hanya dipisah tracking-nya. 429 memakai
  `rlLimitedResponse(agent, hint?, bucket = 'write')` +
  `rlReadLimitedResponse` wrapper; caller lama (≤2 arg) tak
  terpengaruh. Migrasi kunci: kunci bare-agent lama hilang;
  Map in-memory/best-effort sehingga deploy hanya memulai
  kedua bucket dari kosong — tidak ada stored state yang
  terpengaruh. `handleAdminApiRegistered` diperbarui
  menjumlah stamp read+write (sebelumnya membaca kunci bare
  yang kini tak ada, sehingga selalu 0). Test:
  `batch-c.test.ts` (bundle tepat 1 unit read; write-habis →
  bundle/discovery/cutover GET tetap 200; read-habis → ledger
  create tetap 200; ledger write membangunkan poller;
  filter since hanya mengembalikan row yang berubah) dan
  `batch-b.test.ts` (since/changed + wake).

- Item 9 — Discovery endpoint. `GET /api/discovery`
  (bucket read): `{version: 'revamp-v12', commit: 'unknown',
  spec: 'SPEC.md §17.11 (amendment batch)', routes,
  routes_generated_from}`. `commit: 'unknown'` adalah jujur,
  bukan hash karangan — tidak ada konstanta version/commit
  build-time di codebase (dicari dulu). Daftar route BENAR-
  BENAR di-generate saat request dengan introspeksi instance
  Hono live (`(bus as any).app.routes`, dedupe + sort) —
  Hono 4.13 mem-flatten route sub-app lewat `.route()`,
  sehingga mencakup semua modul router, bukan hanya wake.
  Bila introspeksi tak tersedia, payload mengembalikan
  `routes: []` dengan `routes_generated_from: 'unavailable
  (no Hono app introspection)'`, bukan daftar statis yang
  berdandan generated. Tidak ada daftar route tulisan tangan
  di mana pun. Test: `batch-c.test.ts` (routes memuat
  `GET /api/ledger`, `GET /api/kanban/tasks/available`,
  `GET /api/wake`, `GET /api/cutover`, `GET /api/discovery`).

- Item 10 — Sweep threshold (konstanta bernama, bukan magic
  inline). `SWEEP_SINGLE_PASS_MAX_PROJECTS = 20` dan
  `SWEEP_SINGLE_PASS_MAX_TASKS = 500` di
  `handlers/dependencies.ts`. Di bawah threshold (proyek
  terbuka ≤ 20 DAN task terbuka ≤ 500), alarm per jam
  menjalankan single pass: mengunjungi SEMUA proyek terbuka
  dalam satu sweep (tanpa window rotasi 20-proyek) dan
  mengangkat budget kandidat 500 di pass
  `depReevaluateProject` (parameter budget di-thread lewat
  `depEachProjectTask` + opts `{uncapped: true}`). Di atas
  threshold, mesin capped lama
  berlaku (window rotasi + budget). Cap processed per-pass
  (`DEP_FANOUT_CAP` = 100) SENGAJA tidak diangkat bahkan di
  mode single-pass: ia membatasi ukuran satu transaksi, dan
  sisanya konvergen di sweep berikutnya — ini varian faithful
  yang didokumentasikan eksplisit, bukan "uncapped" absolut.
  JSON `sweep_pending` kini juga mencatat `single_pass`,
  `threshold_projects`, `threshold_tasks`, `open_projects`,
  `open_tasks`. Test: `batch-wave2.test.ts` (nilai konstanta;
  perilaku alarm tidak diuji lewat harness — alarm butuh
  konteks DO, sehingga threshold di level alarm
  diverifikasi lewat code-read + field `sweep_pending`).

- Item 11 — Audit retention. Aturan minimum:
  `AUDIT_MIN_RETENTION_DAYS = 90` untuk `dependency_events`
  DAN `ledger_events`, dihitung dari `created_at` (epoch
  detik) masing-masing row. Hook enforcement:
  `POST /admin/api/audit/purge {before_ts}` (admin Basic,
  `before_ts` epoch detik wajib). Request dengan cutoff di
  dalam window retensi → 400 (`earliest_allowed_cutoff`
  disertakan); purge sendiri hanya menghapus row dengan
  `created_at <= before_ts` DAN `before_ts <= now - 90
  hari`, dalam satu transaksi, melaporkan count terhapus per
  tabel, dan mencatat purge di `bus_meta
  'audit_purge_log'` (cap 20 entri — metadata, bukan row
  audit, sehingga selamat dari purge). TIDAK ADA penghapusan
  audit diam-diam: jalur alarm TIDAK PERNAH menghapus row
  audit; purge hanya eksplisit lewat endpoint admin ini.
  Observabilitas: admin stats melaporkan `auditSizes`
  (row count kedua tabel; -1 bila tabel tak terbaca).
  Test: `batch-wave2.test.ts` (purge di dalam window 400;
  purge lewat window menghapus row tua saja, row muda
  dipertahankan; stats membawa `auditSizes`).

- Item 12 — Dissent effect. Dissent kini MENAHAN
  completion/transisi targetnya sampai aksi resolusi resmi
  oleh otoritas: transisi status pada target yang di-dissent-
  hold ditolak 409 dengan ref dissent (wiring-nya di item 1
  — `dissentHoldFor` yang sama; dissent pada task sudah
  ditahan sejak wave 1). `POST /:id/resolve-dissent` (+
  varian admin): hanya admin atau resolver yang ditunjuk
  (author saja → 403, resolver null → admin-only); men-set
  `resolved/resolved_by/resolved_at`, mengaudit
  `resolve_dissent` di `ledger_events`; sesudahnya
  `dissentHoldFor` mengembalikan held: false. Dissent yang
  menarget row ledger: DIIMPLEMENTASIKAN — `ref_type`
  diperluas mencakup `'ledger'` di `validateRef`, filter
  list, dan supersede dissent (tabel ledger v7 tidak punya
  CHECK atas `ref_type`, sehingga tidak perlu langkah
  migrasi). Scope yang dinyatakan presisi: ini di dalam #19
  sebagaimana diputuskan, bukan daftar skip lock-opposition
  (yang menyangkut menghapus/menurunkan, bukan ini).
  Test: `batch-b.test.ts` (dissent pada row ledger dan task,
  kedua predikat hold, 403 non-resolver, resolve oleh
  resolver + admin mengangkat hold, resolve non-dissent
  400).

- Item 13 — Deregistration cleanup. `DELETE
  /admin/api/agents/:agent` kini, dalam satu
  `transactionSync`: menghapus row `agents` (kredensial —
  secret hilang, bearer berhenti bekerja) + kunci rate
  `read:`/`write:` (dan kunci bare legacy) + row
  `project_subscribers` + row `lane_mapping` milik agent;
  me-release klaim/assignment aktif PERSIS menurut semantik
  release yang ada (`handleKbAgentTaskRelease`): doing →
  todo (dan `unblocked_at` dibersihkan, seperti release yang
  mengubah status); todo tetap todo dan mempertahankan
  `unblocked_at`; blocked tetap blocked dengan
  `blocked_from_status`/reason utuh; task done TIDAK
  disentuh (bukan klaim aktif — atribusi pekerjaan selesai
  dipertahankan); `admin_assigned` dibersihkan hanya bila
  menamai agent itu (aturan release yang sama).
  Dipertahankan tak tersentuh: row ledger, `ledger_events`,
  dan `dependency_events` — author/`target_lane` tetap
  sebagai teks historis, tidak pernah ditulis ulang.
  Response membawa `cleanup: {released: {todo, doing,
  blocked} (id-id), rate_keys_deleted, subscribers_deleted,
  lane_mappings_deleted}`; event `agent.deregistered`
  membawa payload yang sama. Re-registrasi mendapat secret
  segar dan TIDAK mewarisi klaim yang dilepas (fresh state).
  Test: `batch-wave2.test.ts` (siklus penuh: assign todo/
  doing/blocked + subscriber + lane + rate entry → deregister
  → transisi tepat + row agents hilang + bearer lama 401 →
  re-register secret baru + klaim tetap lepas + author
  ledger dipertahankan).

- Item 14 — Ref-pointer scan. `validateRef` ditulis ulang
  (`handlers/ledger.ts`): sebelum pointer ref diterima/
  disimpan, ia (1) memindai title/body target dengan helper
  blocklist berkategori bernama `ledgerBlocklistCategory`
  (email/phone/iban/account/secret/address; penolakan 400
  menyebut KATEGORI saja, tidak pernah kontennya) dan
  (2) memeriksa readability caller, memakai logika yang ada
  per kind: `readableInChannel` untuk message,
  `kbSubscriberPred` + non-archived untuk task,
  `ledgerRowVisible` untuk row ledger → 403 bila tak
  terbaca. Admin mem-bypass readability SAJA, tidak pernah
  scan. Perilaku existence-only lama DIGANTI (komentar caveat
  lama disupersede). Catatan konservatif: tidak ada helper
  readability lintas-kind tunggal, sehingga komposisi
  per-kind di atas adalah ceknya; task archived dihitung
  tak terbaca (read task agent mengecualikan proyek
  archived). Jalur kredensial (`hasLuki`/`hasLock`
  supersede) tetap mem-bypass `validateRef` seperti
  sebelumnya — pesan kredensial itu sendiri adalah
  otorisasi, bukan ref biasa. Alasan penolakan
  didokumentasikan: 400 `blocklisted` + kategori, 403
  unreadable, 404 target hilang (perilaku lama).
  Test: `batch-b.test.ts` (message/task ter-blocklist → 400
  dengan `reason: 'secret'`; message channel DM dan task
  subscriber-restricted → 403; target bersih terbaca → 200).

- Item 15 — Comment restore. `POST
  /api/kanban/tasks/:id/comments/:comment_id/restore`
  (author via Bearer) dan varian admin (Basic): membersihkan
  flag deleted (`deleted = 0`, field deleted_* di-NULL-kan),
  sehingga `comment_count` — yang menghitung row non-system
  non-deleted — menghitungnya lagi tanpa recount terpisah.
  Audit trail: system log row `comment restored: id=... by
  <actor>` (kolom `ts`-nya adalah waktu restore) PLUS event
  poll `kanban.comment.restored`. Permission mengikuti
  bentuk yang ada: admin bisa soft-delete, author memiliki
  comment-nya sendiri. Bukan author → 403; hilang → 404;
  tidak ter-delete → 409. Komentar kode lama "soft-delete
  is one-way, no restore endpoint" kini SUPERSEDED.
  Test: `batch-wave2.test.ts` (restore non-author 403,
  restore author 200 + `restored_by` + count kembali + audit
  log menyebut restorer, restore ulang 409, jalur admin 200).

- Item 16 — Real cursors. `/available` dan search kini
  memakai cursor keyset OPAK (base64url JSON dari sort key:
  `{d: due_date|null, p: priority, c: created_at, i: id}`)
  sebagai mekanisme UTAMA, konsisten dengan gaya anchor
  dep-list/ledger. Kontrak per endpoint: `/available` —
  tuple `(COALESCE(due_date,'9999-12-31'), rank priority
  urgent 0 < normal 1 < low 2, created_at, id)` ASC lewat
  komparasi row-value SQLite; `next_cursor` di response;
  cursor menang atas offset (offset diabaikan bila cursor
  ada); offset tanpa cursor tetap bekerja sebagai fallback
  DEPRECATED dan ditandai `pagination_note: 'offset is
  deprecated; use cursor'`; cursor tak valid → 400.
  Search — cursor yang sama HANYA untuk sort default;
  cursor + `sort=blocked_since` → 400 (sort itu punya key
  berbeda dan tidak didefinisikan kontrak cursor-nya);
  offset deprecated dengan cara yang sama. Detail penting:
  `created_at` disimpan sebagai epoch INTEGER di produksi,
  sehingga cursor mempertahankan tipe tersimpan (string
  ATAU number) — koersi ke string akan memecahkan komparasi
  keyset karena SQLite mengurutkan INTEGER < TEXT selalu.
  `next_after_id` tetap null untuk kompatibilitas. Test:
  `batch-wave2.test.ts` (paging cursor tanpa overlap,
  cursor tak valid 400, offset deprecated ditandai, search
  cursor + sort non-default 400).

- Item 17 — Delete fan-out details. Response delete admin
  kini membawa `fanout` penuh di payload (bukan hanya
  penemuan lewat poll): task delete = `links_as_blocked`
  (blocker id), `links_as_blocker` (dependent id), `todos`,
  `labels`, `comments` — masing-masing `{count (total
  eksak), ids/labels (cap 100), truncated}` — di-snapshot
  SEBELUM cascade delete (sesudah delete tidak ada lagi
  yang bisa dihitung); `dependency_cascade` lama tetap ada
  di sampingnya. Project delete = `tasks` (id, cap 100),
  `links` (pasangan blocker/blocked, cap 100), `todos`/
  `labels`/`comments` (count saja — daftar id per task akan
  meledak di proyek besar), `subscribers` (daftar yang
  dihapus). Cap: `DELETE_FANOUT_ID_CAP = 100` di
  `db/events.ts` (`kbFanoutIds`/`kbFanoutPairs`). Test:
  `batch-wave2.test.ts` (task: count + id tiap kategori;
  project: task id + comment count; row benar-benar
  terhapus).

- Item 18 — Pending-sweep visibility. Helper bersama
  `kbSweepVisibility()` (`db/events.ts`): membaca
  `bus_meta 'sweep_pending'` + `alarm_last_completed` +
  hitungan proyek terbuka, mengembalikan
  `{pending_sweep, pending_projects, failed_projects,
  unvisited_projects, window_projects, open_projects,
  single_pass, rotation_window_hours,
  expected_convergence_at, next_sweep_at,
  sweep_pending_at}`. Deadline eksplisit: cadence alarm per
  jam berarti sweep konvergen dalam
  `ceil(open_projects / 20)` jam (bound rotasi); di mode
  single-pass (item 10) bound-nya 1 jam.
  `expected_convergence_at` = now + bound itu;
  `next_sweep_at` = `alarm_last_completed` + 3600 detik
  (null bila belum ada stamp kompletasi). Diekspos di DUA
  permukaan: admin stats sebagai `sweepVisibility` (di
  samping `sweepHealth` lama yang dipertahankan) DAN
  permukaan caller-visible `GET /api/kanban/sweep-health`
  (agent Bearer apa pun boleh membaca — hanya count dan
  bound konvergensi, tanpa konten task; rate bucket read).
  Test: `batch-wave2.test.ts` (kedua permukaan membawa
  field-field kunci + bound konvergensi bertipe string).

- Yang TIDAK dibangun ronde ini (tetap terbuka, bukan
  diam-diam diputuskan): Q7b registrasi agy + Claude Code
  (aksi admin deploy-time, BUKAN tugas implementasi ini —
  lihat gate deploy di bawah); seed list + kondisi cutover
  (#28, tetap ditunda); desain pending-state untuk action
  row (keputusan masa depan terpisah, post-hoc §5 berlaku
  untuk v1); endpoint mark-done checklist cutover; hold-check
  pada rescue; cursor untuk sort search `blocked_since`;
  penghapusan audit otomatis lewat alarm (sengaja tidak
  ada — purge hanya eksplisit admin).

- Fix round (re-review amendment batch, dua gap MAJOR — bukan
  keputusan baru, melainkan implementasi penuh atas keputusan
  Luki yang sudah ada).
  GAP 1 — Dissent pada row ledger kini DITEGAKKAN pada
  supersede DAN tombstone (`handlers/ledger.ts`): sebelum
  mutasi apa pun, kedua handler memeriksa
  `dissentHoldFor('ledger', String(old.id))`; dissent aktif
  yang belum ter-resolve → 409 `{error: 'dissent_held',
  dissent_id}` + hint, tanpa mutasi dan tanpa konsumsi kuota
  (cek berjalan setelah semua validasi, sebelum rate check).
  Admin TIDAK exempt — sama seperti dissent hold pada task
  (item 1): hold mengikat semua writer, dan jalannya keluar
  adalah resolusi resmi (admin atau resolver yang ditunjuk
  lewat `resolve-dissent`), bukan transisi yang mem-bypass.
  Setelah resolve, `dissentHoldFor` mengembalikan held:
  false dan transisi berjalan. Test: `batch-b.test.ts`
  (item 19b: supersede 409 + tombstone 409 + row tak berubah;
  admin supersede 409; setelah resolve supersede 200 +
  tombstone 200). Penegakan dissent pada task tidak berubah
  (masih `kbHoldRejection`, tercakup suite batch-a item 1).
  GAP 2 — Migrasi bucket read SELESAI. Audit semua call site
  `rlCheck` (alias bucket write): 20 site ditemukan, 12
  write dipertahankan, 8 read dimigrasi. Bucket READ (agent
  Bearer) kini: wake bundle, discovery, cutover GET (sudah
  sejak item 8) + list ledger, get ledger, events ledger,
  task detail, sweep-health, dep list, dep events, unblocked,
  `/available`, search. Bucket WRITE yang benar-benar men-charge
  (bukan sekadar konseptual): task status PUT, rescue, dep
  link/unlink (`depApplyLink`), message send, ledger
  create/supersede/tombstone/contradiction/resolver/
  resolve-dissent. Mutasi lain secara konseptual bucket write
  tapi saat ini TIDAK men-charge apa-apa: task create/update/
  claim/release, comment add/soft-delete/restore, label
  add/remove, ledger recheck-assignment, dan ledger seed.
  Endpoint admin tetap exempt.
  429 untuk read yang dimigrasi memakai
  `rlReadLimitedResponse` (retry_after_seconds dari bucket
  read). KOREKSI terhadap premis re-review: `/available`
  dan search TIDAK pernah men-charge bucket write — keduanya
  sebelumnya TIDAK di-charge sama sekali; ronde ini menaruh
  keduanya di bucket read karena brief menyebut keduanya
  eksplisit, ditempatkan setelah semua validasi param agar
  request tak valid tidak mengonsumsi kuota. Klaim item 18
  bahwa sweep-health adalah "rate bucket read" kini BENAR
  secara kode (pada saat re-review ia masih men-charge
  write); sebelum ronde ini klaim itu salah. YANG SENGAJA
  TIDAK DIUBAH: endpoint read agent lain yang sebelumnya
  tidak di-charge (projects list, tasks list, summary,
  activity, comment list, templates list, poll) tetap tidak
  di-charge — migrasi ini hanya memindahkan endpoint yang
  sudah men-charge, plus `/available` + search yang
  disebut eksplisit; menambah charge baru ke endpoint bebas
  lainnya akan menjadi perubahan perilaku di luar gap.
  Test: `batch-c.test.ts` (write habis → 11 triage read
  tetap 200; read habis → read ke-11 429 + write ledger
  tetap 200). Wart §17.6: kalimat lama preservasi re-claim
  yang masih tersisa inline beserta catatan koreksinya
  sudah diganti kalimat aturan yang benar (blanket-clear),
  sehingga pembaca yang berhenti di tengah paragraf tidak
  lagi disesatkan; semantik §4 tidak berubah, hanya prosa.
  Re-roast 9, fix round bug-hunter M1+M2 (+ minor m1, dokumen).
  M1: cursor keyset `d` kini menerima due_date INTEGER
  (sebelumnya string-only sehingga cursor halaman 2 ditolak 400
  bila task batas halaman 1 punya due date); encode site membawa
  tipe tersimpan, bukan cast string palsu; `kbKeysetParams`
  meneruskan tipe itu tanpa koersi sehingga urutan SQLite
  INTEGER < TEXT menjaga row ber-due-date sebelum row null-due,
  persis seperti NULLS-LAST di `kbDefaultOrder`. Test:
  `batch-wave2.test.ts` (walk /available dan search melintasi
  boundary ber-due-date, urutan due_date, tanpa duplikat).
  M2: row dissent aktif yang belum resolved TIDAK bisa keluar
  lewat supersede/tombstone (409 `dissent_unresolved`, admin
  tidak exempt) - satu-satunya jalan keluar selagi unresolved
  adalah resolve-dissent (admin atau resolver yang ditunjuk);
  setelah resolved, row itu row aktif biasa dan transisi
  berjalan. Row hold/gate sengaja TIDAK diperlakukan sama:
  tidak ada endpoint release khusus untuk hold, sehingga row
  hold keluar lewat tombstone (atau supersede yang mengubah
  kind-nya dari hold/gate) - author mengangkat gate-nya sendiri,
  tercatat sebagai transisi ledger; supersede biasa dengan kind
  diwarisi justru MENGGANTI hold dengan successor hold row, sama
  seperti successor dissent. Dissent berbeda karena ia keberatan
  pihak ketiga dengan resolver yang ditunjuk, bukan gate milik
  author sendiri. Test: `batch-b.test.ts` item 19c.
  Kontrak cursor-filter (minor m1, DOKUMENTASI SAJA): cursor
  /available dan search hanya mengkode sort key, BUKAN filter
  (status, exclude_blocked, q, ...). Mengganti filter antar
  halaman dengan cursor yang sama diam-diam melewatkan /
  menduplikasi row; cursor hanya valid untuk query/filter yang
  sama - ganti filter berarti mulai lagi dari halaman pertama
  tanpa cursor. Encoding filter ke dalam cursor TIDAK dilakukan
  ronde ini.

### 17.12 Argon safety round (LGTM Luki 2026-11-03 atas rekomendasi dormant-ship Argon; BUKAN perintah deploy)

  Item 1 - kunci flip cutover: flip KELUAR dari
  `memory_authoritative` kini 409 `cutover flip locked` dengan hint
  menunjuk seed list + endpoint mark-done checklist (keduanya belum
  ada, sehingga praktis tidak ada flip keluar yang mungkin sekarang);
  flip KE / bertahan di `memory_authoritative` tetap 200 seperti
  sebelumnya. Flip yang ditolak tidak mengubah state, tidak menulis
  audit log `cutover_flips`, tidak memancarkan event
  `cutover.flipped`; transisi yang diizinkan tetap mencatat keduanya.
  Test: `batch-c.test.ts` (blok flip diperbarui SECARA SENGAJA
  mengikuti perubahan kontrak ini - flip-away 409 + flag tidak
  berubah + log audit kosong, stay 200 - bukan pelemahan test).
  Item 2 - pernyataan non-otoritatif: `GET /api/discovery` dan
  `GET /api/wake` membawa `authority_state` + `authority_note` yang
  diturunkan dari flag saat itu, TIDAK di-hardcode. Di bawah
  `memory_authoritative`: "MEMORY.md is the sole authoritative
  source; the ledger must not be used as final decision
  authority" (dikutip persis dari `authorityNote` di `wake.ts`).
  Di bawah `bus_authoritative`: "the
  ledger is the authoritative source" (tanpa wording dormant).
  Discovery juga membawa `contradiction_note` (lihat item 5).
  Item 3 - transparansi wake: holds dibatasi 100 dengan flag
  `holds_truncated`; unblocked dibatasi 20 dengan
  `unblocked_has_more`; `ledger_changed` dibatasi 100 bila `?since`
  ada (20 bila tidak) dengan `ledger_changed_has_more`. Semua flag
  dihitung lewat LIMIT cap+1, tanpa query hitung kedua per seksi.
  `holds` tetap tanpa pagination di luar cap ini (cap 100 adalah
  batas aman, bukan halaman).
  Item 4 - freeing blocker: kolom baru `tasks.unblocked_by_blocker_id`
  (migrasi v10, NULL untuk row lama) ditulis HANYA oleh
  `depUnblockRow`, lewat parameter `freeingBlockerId`: completion
  (blocker yang selesai), unlink (blocker yang dilepas),
  delete-cascade (task yang dihapus), sweep (blocker done dengan id
  terendah; NULL bila tidak ada blocker done - kasus orphan
  sentinel (b)). Kolom ini INTERNAL: setiap read site
  mengupasnya dan mengekspos `freeing_blocker_id` publik yang
  di-gate pada `unblocked_at` (null bila `unblocked_at` null),
  sehingga nilai basi pada task yang sudah di-claim / di-block
  ulang tidak pernah muncul. `freeing_blocker_id` hadir di: dep
  unblocked list, seksi unblocked wake, dan payload event
  `kanban.task.unblocked`. Unblock MANUAL tidak punya freeing
  blocker: kedua emit manual di `kanban.ts` membawa
  `freeing_blocker_id: null`, dan task yang di-unblock manual tidak
  pernah masuk unblocked list (unblocked_at dibersihkan, bukan
  di-set - aturan fix round C7/M6 tidak berubah). Test:
  `batch-c.test.ts` (completion menamai blocker di list + wake;
  manual null + tidak masuk list; kolom storage tidak terekspos).
  Item 5 - kontradiksi sebagai anotasi (DOKUMENTASI SAJA, tanpa
  perubahan perilaku endpoint kontradiksi): flag kontradiksi adalah
  anotasi saja - ia mencatat bahwa dua row saling bertentangan,
  TIDAK menyelesaikan konflik dan TIDAK menahan transisi. Yang
  menahan transisi sampai resolusi resmi adalah dissent (item 19):
  dissent aktif mem-409 supersede/tombstone row targetnya sampai
  resolve-dissent. Catatan ini hidup di SPEC ini dan di discovery
  (`contradiction_note`).
  Item 6 - TIDAK DIIMPLEMENTASIKAN (varian reject, sesuai perintah
  tugas: coba, dan bila merusak suite dengan cara yang menunjukkan
  konflik dengan semantik inti plan terkunci, laporkan dan biarkan
  tidak terimplementasi - JANGAN tulis ulang test untuk
  menyembunyikannya). Percobaan empiris: reject 409 untuk create
  dan seed kind hold/gate selama `memory_authoritative`
  MEMATAHKAN 2 suite: v12 ("action without endorsement 400:
  expected 400, got 409" - reject dormant mendahului validasi
  endorsement sehingga mengubah precedence error) dan batch-b
  ("item19 hold row: expected 200, got 409" - fixture hold untuk
  penegakan hold #19 tidak bisa dibuat sama sekali). Akar konflik:
  hold/gate adalah kind inti plan §5 yang terkunci, dan penegakan
  hold mekanis #3 (keputusan Luki 2026-11-03) MEMBACA row hold/gate
  aktif - menolak pembuatannya dalam state default/deploy
  (`memory_authoritative`) membuat mesin hold yang terkunci tidak
  bisa dipakai. Percobaan di-REVERT penuh (tidak ada sisa
  `getAuthorityState` di `ledger.ts`, checksum repo = runner),
  suite kembali hijau 6/6. Varian alternatif Argon (tandai
  hold/gate dormant sebagai eksperimental, bukan reject) TIDAK
  dibangun ronde ini - itu keputusan Luki, bukan implementasi
  diam-diam. Hold model task-target (kanban blocked) memang di
  luar scope item ini sejak awal.
  Item 7 - isolasi admin Basic (ATURAN OPS SAJA, tanpa redesign
  auth ronde ini): kredensial admin Basic dipegang dan dipakai
  HANYA oleh Luki secara pribadi, tidak pernah dibagikan ke
  otomasi agen. Pemisahan mekanisme luki-stamp + endorsement-bypass
  dari admin Basic dicatat sebagai pekerjaan masa depan, TIDAK
  dibangun di sini.
  Catatan runner: ekspektasi versi migrasi di file runner-only
  `kanban-rev5-v12run.test.ts` diperpanjang [2..9] -> [2..10]
  mengikuti migrasi v10 yang nyata (preseden yang sama seperti
  ronde v9); file itu bukan bagian repo dan tidak di-commit.
