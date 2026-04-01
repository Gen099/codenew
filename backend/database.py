"""Database access for Video Creator Tool."""
import os, uuid, time, bcrypt, sqlite3, json
from dotenv import load_dotenv

try:
    import psycopg2
    from psycopg2.extras import DictCursor
except ImportError:
    psycopg2 = None
    DictCursor = None

try:
    from . import runtime_paths
except ImportError:
    import runtime_paths

runtime_paths.ensure_runtime_dirs()
load_dotenv(runtime_paths.ENV_FILE)


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in ("1", "true", "yes", "on")

class DBWrapper:
    def __init__(self, conn, sqlite_mode: bool = False):
        self.conn = conn
        self.sqlite_mode = sqlite_mode
        self._cursor = conn.cursor()

    def cursor(self):
        return self.conn.cursor()

    def execute(self, sql, params=()):
        if not self.sqlite_mode:
            sql = sql.replace("?", "%s")
        # Fix SQLite specific syntax if accidentally matched, though mostly schema related
        try:
            self._cursor.execute(sql, params)
        except Exception as e:
            self.conn.rollback()
            raise e
        return self._cursor

    def executescript(self, sql):
        try:
            if self.sqlite_mode:
                # sqlite3 only allows one statement per execute(); use executescript for schema batches.
                self._cursor = self.conn.executescript(sql)
            else:
                self._cursor.execute(sql)
        except Exception as e:
            self.conn.rollback()
            raise e
        return self._cursor

    def executemany(self, sql, param_list):
        if not self.sqlite_mode:
            sql = sql.replace("?", "%s")
        try:
            self._cursor.executemany(sql, param_list)
        except Exception as e:
            self.conn.rollback()
            raise e
        return self._cursor

    def commit(self):
        self.conn.commit()

    def close(self):
        self._cursor.close()
        self.conn.close()


def _get_database_url() -> str:
    return (os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL") or "").strip()


def get_conn():
    db_url = _get_database_url()
    if db_url:
        if psycopg2 is None:
            raise RuntimeError("psycopg2 is required when DATABASE_URL or SUPABASE_DB_URL is configured.")
        conn = psycopg2.connect(db_url, cursor_factory=DictCursor)
        # Autocommit false to mimic sqlite3 transaction behavior matching our commit() calls
        return DBWrapper(conn)

    conn = sqlite3.connect(runtime_paths.LOCAL_SQLITE_FILE)
    conn.row_factory = sqlite3.Row
    return DBWrapper(conn, sqlite_mode=True)


def init_db():
    conn = get_conn()
    if conn.sqlite_mode:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                display_name TEXT NOT NULL,
                role TEXT DEFAULT 'staff',
                login_2fa_enabled INTEGER DEFAULT 0,
                active INTEGER DEFAULT 1,
                created_at REAL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT UNIQUE NOT NULL,
                batch_id TEXT DEFAULT '',
                user_name TEXT DEFAULT '',
                user_display TEXT DEFAULT '',
                status TEXT DEFAULT 'pending',
                prompt TEXT DEFAULT '',
                gen_mode TEXT DEFAULT 'img2vid',
                duration INTEGER DEFAULT 5,
                aspect_ratio TEXT DEFAULT '16:9',
                camera_move TEXT DEFAULT '',
                credit_used REAL DEFAULT 0,
                result_url TEXT DEFAULT '',
                fail_msg TEXT DEFAULT '',
                created_at TEXT DEFAULT '',
                completed_at TEXT DEFAULT '',
                provider TEXT DEFAULT 'provider1',
                work_task_id TEXT DEFAULT '',
                output_filename TEXT DEFAULT '',
                source_url TEXT DEFAULT '',
                task_type TEXT DEFAULT 'video',
                product_code TEXT DEFAULT '',
                media_type TEXT DEFAULT 'video',
                staff_id TEXT DEFAULT '',
                session_id TEXT DEFAULT '',
                model_id TEXT DEFAULT '',
                model_label TEXT DEFAULT '',
                cost_unit TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS pending_logins (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                username TEXT NOT NULL,
                ip TEXT DEFAULT '',
                device TEXT DEFAULT '',
                status TEXT DEFAULT 'pending',
                created_at REAL DEFAULT 0,
                expires_at REAL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS qc_queue (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                video_url TEXT DEFAULT '',
                user_name TEXT DEFAULT '',
                user_display TEXT DEFAULT '',
                note TEXT DEFAULT '',
                status TEXT DEFAULT 'pending',
                reviewer TEXT DEFAULT '',
                reject_reason TEXT DEFAULT '',
                submitted_at REAL DEFAULT 0,
                reviewed_at REAL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                type TEXT DEFAULT '',
                title TEXT DEFAULT '',
                body TEXT DEFAULT '',
                read INTEGER DEFAULT 0,
                data_json TEXT DEFAULT '{}',
                created_at REAL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS live_presence (
                user_name TEXT PRIMARY KEY,
                display_name TEXT DEFAULT '',
                role TEXT DEFAULT 'staff',
                current_code TEXT DEFAULT '',
                current_task TEXT DEFAULT '',
                current_entries_json TEXT DEFAULT '[]',
                shift_started_at REAL DEFAULT 0,
                online_since REAL DEFAULT 0,
                last_seen REAL DEFAULT 0,
                active_tasks INTEGER DEFAULT 0,
                announced_codes_json TEXT DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS shift_reports (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                user_name TEXT DEFAULT '',
                user_display TEXT DEFAULT '',
                total_tasks INTEGER DEFAULT 0,
                total_credits REAL DEFAULT 0,
                notes TEXT DEFAULT '',
                submitted_at REAL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS work_tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT DEFAULT '',
                user_name TEXT NOT NULL,
                user_display TEXT DEFAULT '',
                status TEXT DEFAULT 'active',
                video_count INTEGER DEFAULT 0,
                credits_used REAL DEFAULT 0,
                created_at REAL DEFAULT 0,
                closed_at REAL DEFAULT 0,
                notes TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS input_assets (
                id TEXT PRIMARY KEY,
                user_id TEXT DEFAULT '',
                user_name TEXT NOT NULL,
                user_display TEXT DEFAULT '',
                session_id TEXT DEFAULT '',
                code_tag TEXT DEFAULT '',
                folder_name TEXT DEFAULT '',
                file_name TEXT DEFAULT '',
                mime_type TEXT DEFAULT '',
                source_url TEXT DEFAULT '',
                width INTEGER DEFAULT 0,
                height INTEGER DEFAULT 0,
                edited INTEGER DEFAULT 0,
                derived_from_asset_id TEXT DEFAULT '',
                created_at REAL DEFAULT 0,
                updated_at REAL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS presets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                icon TEXT DEFAULT '',
                prompt_prefix TEXT DEFAULT '',
                prompt_suffix TEXT DEFAULT '',
                model TEXT DEFAULT 'nano-banana-pro',
                is_default INTEGER DEFAULT 0,
                effect_group TEXT DEFAULT 'general'
            );

            CREATE TABLE IF NOT EXISTS activity_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT,
                user_name TEXT,
                action TEXT,
                detail TEXT,
                credits REAL DEFAULT 0,
                provider TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS ai_chat_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_name TEXT NOT NULL,
                session_key TEXT NOT NULL,
                work_task_id TEXT DEFAULT '',
                chat_model TEXT DEFAULT 'gpt-5-4',
                chat_skill TEXT DEFAULT '',
                system_prompt TEXT DEFAULT '',
                messages_json TEXT DEFAULT '[]',
                analyze_model TEXT DEFAULT 'gpt-5-4',
                analyze_skill TEXT DEFAULT '',
                analyze_system_prompt TEXT DEFAULT '',
                analyze_prompt TEXT DEFAULT '',
                analyze_file_name TEXT DEFAULT '',
                analyze_result_json TEXT DEFAULT '{}',
                updated_at REAL DEFAULT 0,
                created_at REAL DEFAULT 0,
                UNIQUE(user_name, session_key)
            );

            CREATE TABLE IF NOT EXISTS ai_chat_memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_name TEXT NOT NULL,
                session_key TEXT NOT NULL,
                work_task_id TEXT DEFAULT '',
                memory_text TEXT DEFAULT '',
                updated_at REAL DEFAULT 0,
                created_at REAL DEFAULT 0,
                UNIQUE(user_name, session_key)
            );

            CREATE TABLE IF NOT EXISTS ai_chat_analysis_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_name TEXT NOT NULL,
                session_key TEXT NOT NULL,
                work_task_id TEXT DEFAULT '',
                analyze_model TEXT DEFAULT 'gpt-5-4',
                analyze_skill TEXT DEFAULT '',
                analyze_system_prompt TEXT DEFAULT '',
                analyze_prompt TEXT DEFAULT '',
                analyze_file_name TEXT DEFAULT '',
                analysis_json TEXT DEFAULT '{}',
                created_at REAL DEFAULT 0
            );
        """)
        try:
            cols = [row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()]
            if "login_2fa_enabled" not in cols:
                conn.execute("ALTER TABLE users ADD COLUMN login_2fa_enabled INTEGER DEFAULT 0")
        except Exception:
            pass
        try:
            task_cols = [row[1] for row in conn.execute("PRAGMA table_info(tasks)").fetchall()]
            if "batch_id" not in task_cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN batch_id TEXT DEFAULT ''")
            if "output_filename" not in task_cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN output_filename TEXT DEFAULT ''")
            if "product_code" not in task_cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN product_code TEXT DEFAULT ''")
            if "media_type" not in task_cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN media_type TEXT DEFAULT 'video'")
            if "staff_id" not in task_cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN staff_id TEXT DEFAULT ''")
            if "session_id" not in task_cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN session_id TEXT DEFAULT ''")
            if "model_id" not in task_cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN model_id TEXT DEFAULT ''")
            if "model_label" not in task_cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN model_label TEXT DEFAULT ''")
            if "cost_unit" not in task_cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN cost_unit TEXT DEFAULT ''")
            conn.execute("UPDATE tasks SET staff_id=COALESCE(NULLIF(staff_id,''), user_name)")
            conn.execute("UPDATE tasks SET session_id=COALESCE(NULLIF(session_id,''), work_task_id)")
            conn.execute(
                "UPDATE tasks SET media_type = CASE "
                "WHEN lower(COALESCE(task_type,'')) IN ('image','image_edit') OR lower(COALESCE(gen_mode,''))='image_edit' THEN 'image' "
                "WHEN lower(COALESCE(task_type,'')) IN ('audio','music','sound') OR lower(COALESCE(gen_mode,'')) IN ('audio','txt2audio','speech') THEN 'audio' "
                "ELSE 'video' END "
                "WHERE COALESCE(media_type,'')=''"
            )
        except Exception:
            pass
        try:
            hist_cols = [row[1] for row in conn.execute("PRAGMA table_info(ai_chat_history)").fetchall()]
            for col_name, col_sql in [
                ("analyze_model", "TEXT DEFAULT 'gpt-5-4'"),
                ("analyze_skill", "TEXT DEFAULT ''"),
                ("analyze_system_prompt", "TEXT DEFAULT ''"),
                ("analyze_prompt", "TEXT DEFAULT ''"),
                ("analyze_file_name", "TEXT DEFAULT ''"),
                ("analyze_result_json", "TEXT DEFAULT '{}'"),
            ]:
                if col_name not in hist_cols:
                    conn.execute(f"ALTER TABLE ai_chat_history ADD COLUMN {col_name} {col_sql}")
        except Exception:
            pass
    else:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                display_name TEXT NOT NULL,
                role TEXT DEFAULT 'staff',
                login_2fa_enabled INTEGER DEFAULT 0,
                active INTEGER DEFAULT 1,
                created_at REAL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS tasks (
                id SERIAL PRIMARY KEY,
                task_id TEXT UNIQUE NOT NULL,
                batch_id TEXT DEFAULT '',
                user_name TEXT DEFAULT '',
                user_display TEXT DEFAULT '',
                status TEXT DEFAULT 'pending',
                prompt TEXT DEFAULT '',
                gen_mode TEXT DEFAULT 'img2vid',
                duration INTEGER DEFAULT 5,
                aspect_ratio TEXT DEFAULT '16:9',
                camera_move TEXT DEFAULT '',
                credit_used REAL DEFAULT 0,
                result_url TEXT DEFAULT '',
                fail_msg TEXT DEFAULT '',
                created_at TEXT DEFAULT '',
                completed_at TEXT DEFAULT '',
                provider TEXT DEFAULT 'provider1',
                work_task_id TEXT DEFAULT '',
                output_filename TEXT DEFAULT '',
                source_url TEXT DEFAULT '',
                task_type TEXT DEFAULT 'video',
                product_code TEXT DEFAULT '',
                media_type TEXT DEFAULT 'video',
                staff_id TEXT DEFAULT '',
                session_id TEXT DEFAULT '',
                model_id TEXT DEFAULT '',
                model_label TEXT DEFAULT '',
                cost_unit TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS pending_logins (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                username TEXT NOT NULL,
                ip TEXT DEFAULT '',
                device TEXT DEFAULT '',
                status TEXT DEFAULT 'pending',
                created_at REAL DEFAULT 0,
                expires_at REAL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS qc_queue (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                video_url TEXT DEFAULT '',
                user_name TEXT DEFAULT '',
                user_display TEXT DEFAULT '',
                note TEXT DEFAULT '',
                status TEXT DEFAULT 'pending',
                reviewer TEXT DEFAULT '',
                reject_reason TEXT DEFAULT '',
                submitted_at REAL DEFAULT 0,
                reviewed_at REAL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                type TEXT DEFAULT '',
                title TEXT DEFAULT '',
                body TEXT DEFAULT '',
                read INTEGER DEFAULT 0,
                data_json TEXT DEFAULT '{}',
                created_at REAL DEFAULT 0
            );

            DO $$
            BEGIN
                CREATE TABLE IF NOT EXISTS live_presence (
                    user_name TEXT PRIMARY KEY,
                    display_name TEXT DEFAULT '',
                    role TEXT DEFAULT 'staff',
                    current_code TEXT DEFAULT '',
                    current_task TEXT DEFAULT '',
                    current_entries_json TEXT DEFAULT '[]',
                    shift_started_at DOUBLE PRECISION DEFAULT 0,
                    online_since DOUBLE PRECISION DEFAULT 0,
                    last_seen DOUBLE PRECISION DEFAULT 0,
                    active_tasks INTEGER DEFAULT 0,
                    announced_codes_json TEXT DEFAULT '[]'
                );
            EXCEPTION
                WHEN duplicate_table OR duplicate_object THEN
                    NULL;
            END
            $$;

            CREATE TABLE IF NOT EXISTS shift_reports (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                user_name TEXT DEFAULT '',
                user_display TEXT DEFAULT '',
                total_tasks INTEGER DEFAULT 0,
                total_credits REAL DEFAULT 0,
                notes TEXT DEFAULT '',
                submitted_at REAL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS work_tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT DEFAULT '',
                user_name TEXT NOT NULL,
                user_display TEXT DEFAULT '',
                status TEXT DEFAULT 'active',
                video_count INTEGER DEFAULT 0,
                credits_used REAL DEFAULT 0,
                created_at REAL DEFAULT 0,
                closed_at REAL DEFAULT 0,
                notes TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS input_assets (
                id TEXT PRIMARY KEY,
                user_id TEXT DEFAULT '',
                user_name TEXT NOT NULL,
                user_display TEXT DEFAULT '',
                session_id TEXT DEFAULT '',
                code_tag TEXT DEFAULT '',
                folder_name TEXT DEFAULT '',
                file_name TEXT DEFAULT '',
                mime_type TEXT DEFAULT '',
                source_url TEXT DEFAULT '',
                width INTEGER DEFAULT 0,
                height INTEGER DEFAULT 0,
                edited INTEGER DEFAULT 0,
                derived_from_asset_id TEXT DEFAULT '',
                created_at DOUBLE PRECISION DEFAULT 0,
                updated_at DOUBLE PRECISION DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS presets (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                icon TEXT DEFAULT '',
                prompt_prefix TEXT DEFAULT '',
                prompt_suffix TEXT DEFAULT '',
                model TEXT DEFAULT 'nano-banana-pro',
                is_default INTEGER DEFAULT 0,
                effect_group TEXT DEFAULT 'general'
            );

            CREATE TABLE IF NOT EXISTS activity_logs (
                id SERIAL PRIMARY KEY,
                timestamp TEXT,
                user_name TEXT,
                action TEXT,
                detail TEXT,
                credits REAL DEFAULT 0,
                provider TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS ai_chat_history (
                id SERIAL PRIMARY KEY,
                user_name TEXT NOT NULL,
                session_key TEXT NOT NULL,
                work_task_id TEXT DEFAULT '',
                chat_model TEXT DEFAULT 'gpt-5-4',
                chat_skill TEXT DEFAULT '',
                system_prompt TEXT DEFAULT '',
                messages_json TEXT DEFAULT '[]',
                analyze_model TEXT DEFAULT 'gpt-5-4',
                analyze_skill TEXT DEFAULT '',
                analyze_system_prompt TEXT DEFAULT '',
                analyze_prompt TEXT DEFAULT '',
                analyze_file_name TEXT DEFAULT '',
                analyze_result_json TEXT DEFAULT '{}',
                updated_at DOUBLE PRECISION DEFAULT 0,
                created_at DOUBLE PRECISION DEFAULT 0,
                UNIQUE(user_name, session_key)
            );

            CREATE TABLE IF NOT EXISTS ai_chat_memories (
                id SERIAL PRIMARY KEY,
                user_name TEXT NOT NULL,
                session_key TEXT NOT NULL,
                work_task_id TEXT DEFAULT '',
                memory_text TEXT DEFAULT '',
                updated_at DOUBLE PRECISION DEFAULT 0,
                created_at DOUBLE PRECISION DEFAULT 0,
                UNIQUE(user_name, session_key)
            );

            CREATE TABLE IF NOT EXISTS ai_chat_analysis_records (
                id SERIAL PRIMARY KEY,
                user_name TEXT NOT NULL,
                session_key TEXT NOT NULL,
                work_task_id TEXT DEFAULT '',
                analyze_model TEXT DEFAULT 'gpt-5-4',
                analyze_skill TEXT DEFAULT '',
                analyze_system_prompt TEXT DEFAULT '',
                analyze_prompt TEXT DEFAULT '',
                analyze_file_name TEXT DEFAULT '',
                analysis_json TEXT DEFAULT '{}',
                created_at DOUBLE PRECISION DEFAULT 0
            );
        """)
        try:
            cols = conn.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name='users'"
            ).fetchall()
            col_names = {row[0] for row in cols}
            if "login_2fa_enabled" not in col_names:
                conn.execute("ALTER TABLE users ADD COLUMN login_2fa_enabled INTEGER DEFAULT 0")
        except Exception:
            pass
        try:
            cols = conn.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name='tasks'"
            ).fetchall()
            col_names = {row[0] for row in cols}
            if "batch_id" not in col_names:
                conn.execute("ALTER TABLE tasks ADD COLUMN batch_id TEXT DEFAULT ''")
            if "output_filename" not in col_names:
                conn.execute("ALTER TABLE tasks ADD COLUMN output_filename TEXT DEFAULT ''")
            if "product_code" not in col_names:
                conn.execute("ALTER TABLE tasks ADD COLUMN product_code TEXT DEFAULT ''")
            if "media_type" not in col_names:
                conn.execute("ALTER TABLE tasks ADD COLUMN media_type TEXT DEFAULT 'video'")
            if "staff_id" not in col_names:
                conn.execute("ALTER TABLE tasks ADD COLUMN staff_id TEXT DEFAULT ''")
            if "session_id" not in col_names:
                conn.execute("ALTER TABLE tasks ADD COLUMN session_id TEXT DEFAULT ''")
            if "model_id" not in col_names:
                conn.execute("ALTER TABLE tasks ADD COLUMN model_id TEXT DEFAULT ''")
            if "model_label" not in col_names:
                conn.execute("ALTER TABLE tasks ADD COLUMN model_label TEXT DEFAULT ''")
            if "cost_unit" not in col_names:
                conn.execute("ALTER TABLE tasks ADD COLUMN cost_unit TEXT DEFAULT ''")
            conn.execute("UPDATE tasks SET staff_id=COALESCE(NULLIF(staff_id,''), user_name)")
            conn.execute("UPDATE tasks SET session_id=COALESCE(NULLIF(session_id,''), work_task_id)")
            conn.execute(
                "UPDATE tasks SET media_type = CASE "
                "WHEN lower(COALESCE(task_type,'')) IN ('image','image_edit') OR lower(COALESCE(gen_mode,''))='image_edit' THEN 'image' "
                "WHEN lower(COALESCE(task_type,'')) IN ('audio','music','sound') OR lower(COALESCE(gen_mode,'')) IN ('audio','txt2audio','speech') THEN 'audio' "
                "ELSE 'video' END "
                "WHERE COALESCE(media_type,'')=''"
            )
        except Exception:
            pass
        try:
            cols = conn.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name='ai_chat_history'"
            ).fetchall()
            col_names = {row[0] for row in cols}
            for col_name, col_sql in [
                ("analyze_model", "TEXT DEFAULT 'gpt-5-4'"),
                ("analyze_skill", "TEXT DEFAULT ''"),
                ("analyze_system_prompt", "TEXT DEFAULT ''"),
                ("analyze_prompt", "TEXT DEFAULT ''"),
                ("analyze_file_name", "TEXT DEFAULT ''"),
                ("analyze_result_json", "TEXT DEFAULT '{}'"),
            ]:
                if col_name not in col_names:
                    conn.execute(f"ALTER TABLE ai_chat_history ADD COLUMN {col_name} {col_sql}")
        except Exception:
            pass
    try:
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_user_created ON tasks(user_name, created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_user_status_created ON tasks(user_name, status, created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_work_task ON tasks(work_task_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_batch ON tasks(batch_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_product_code ON tasks(product_code)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_qc_queue_task_submitted ON qc_queue(task_id, submitted_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created ON notifications(user_id, read, created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_work_tasks_user_status_created ON work_tasks(user_name, status, created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_shift_reports_user_submitted ON shift_reports(user_name, submitted_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_live_presence_last_seen ON live_presence(last_seen)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_input_assets_user_created ON input_assets(user_name, created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_input_assets_session_code ON input_assets(session_id, code_tag)")
    except Exception:
        pass
    conn.commit()
    conn.close()
    if _env_flag("APP_SEED_USERS", True):
        _seed_users()
    if _env_flag("APP_SEED_PRESETS", True):
        _seed_presets()


def _seed_users():
    """Seed only mandatory bootstrap account(s)."""
    conn = get_conn()
    accounts = [
        ("admin", "admin123", "Admin", "admin"),
    ]
    for username, password, display_name, role in accounts:
        exists = conn.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone()
        if not exists:
            pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
            conn.execute(
                "INSERT INTO users (id, username, password_hash, display_name, role, created_at) VALUES (?,?,?,?,?,?)",
                (str(uuid.uuid4()), username, pw_hash, display_name, role, time.time())
            )
    conn.commit()
    conn.close()


def _seed_presets():
    """Insert default image editing presets if table empty."""
    conn = get_conn()
    count = conn.execute("SELECT COUNT(*) FROM presets").fetchone()[0]
    if count > 0:
        conn.close()
        return
    presets = [
        # Day/Night
        ("Day to night", "🌙", "day_night", "Change day to night, add LED strips, turn artificial lights on, make cozy vibe", "maintain original composition and scene layout"),
        ("Night to day", "☀", "day_night", "Change night to day", "maintain original composition, bright natural light, clear sky"),
        ("Golden hour", "🌅", "day_night", "Change the mood to golden hour, add low magical sun rays gently piercing through the shadows", "warm golden tones, long shadows, cinematic, maintain original composition"),
        # Season
        ("Winter", "❄", "season", "Transfer this image to winter, add snow", "snow on surfaces, cold light, bare trees where applicable, maintain original scene"),
        ("Autumn", "🍂", "season", "Transfer this image to autumn, add falling leaves, atmospheric light, subtle rays", "warm amber tones, falling leaves, atmospheric, maintain original scene"),
        ("Spring", "🌸", "season", "Transfer this image to spring, add cherry blossoms and fresh green vegetation", "soft pastel tones, fresh light, blooming flowers, maintain original scene"),
        ("Summer", "☀", "season", "Transfer this image to summer, add lush green vegetation, bright sunny sky", "vibrant green tones, clear blue sky, warm saturated light, maintain original scene"),
        # Weather
        ("Rain", "🌧", "weather", "Add gentle rainfall: fine rain droplets visible, wet ground with reflections, small puddles forming, overcast soft lighting", "moody cinematic atmosphere, warm interior light contrast, photorealistic"),
        ("Fog", "🌁", "weather", "Envelop in ethereal morning mist: depth layers from sharp foreground fading into soft white mist, warm sunrise light filtering through creating volumetric god-ray effects", "mysterious premium atmosphere, photorealistic"),
        ("Volumetric", "🌫", "weather", "Add volumetric rays coming behind trees shadow, enhance atmosphere", "god rays, cinematic atmosphere, maintain original composition"),
        # People
        ("Add people", "🧍", "people", "Add 1-2 people naturally integrated into the scene: consistent lighting and shadows, proportional scale", "natural relaxed poses, photorealistic, 4K"),
        ("Blurred people", "👥", "people", "Add blurred people in motion: motion blur effect", "realistic scale, keep original scene intact, cinematic"),
        ("Add agent", "🧑‍💼", "people", "Add a professional real estate agent standing confidently at the foreground: wearing smart business casual, warm welcoming smile, gesturing toward the property", "proper lighting matching environment, photorealistic, 4K"),
        # Furniture
        ("Virtual staging", "🪑", "furniture", "Add modern Scandinavian furniture to empty spaces: sofa set, coffee table, patterned rug, floor lamp, artwork. Ensure furniture scales perfectly, natural light casts soft shadows", "professional virtual staging, photorealistic, 4K"),
        ("Add flowers", "🌸", "furniture", "Add flowers and decorative plants inside", "natural placement, realistic scale, harmonious with interior"),
        ("Add trees", "🌳", "furniture", "Add trees and tall vegetation in the scene", "natural placement, realistic scale, proportional to architecture"),
        ("Add grass", "🌿", "furniture", "Add lush grass and ground vegetation, enhance landscaping", "natural green tones, realistic texture, maintain original scene"),
        ("Add cars", "🚗", "furniture", "Add cars parked naturally in the driveway", "realistic scale and positioning, integrated naturally into the scene"),
        # Noel
        ("Christmas", "🎄", "noel", "Decorate with Christmas elements: large traditional Christmas tree with colorful baubles, garland with warm LED lights on mantelpiece, stockings, warm twinkling light glow mixing with fireplace", "photorealistic, cozy Christmas mood, 4K"),
        ("Candle glow", "🕯", "noel", "Light the candles: realistic flame on candle wicks, subtle localized tungsten-colored glow on wax and table surface", "seamless, photorealistic, calm ambient mood"),
        # Creative
        ("Golden dust", "✨", "creative", "Add subtle magical golden dust particles floating slowly through air, catching warm ambient light, concentrated near the architectural focal point", "Premium editorial photography meets subtle CGI, photorealistic, 4K"),
        ("Neon accent", "💫", "creative", "Add elegant light trails tracing along the architectural edges at twilight, smooth flowing light ribbons accentuating building geometry", "cinematic long-exposure style, photorealistic, 4K"),
        # Technical
        ("Design board", "🏛", "technical", "Create a high-end editorial design presentation board. One large dominant isometric cut-away axonometric view as focal point, front elevation with subtle dimensions, secondary elevation highlighting materials, curated material swatches", "soft beige and warm wood palette, thin architectural linework, high resolution, sharp details"),
        ("View to render", "🏗", "technical", "Create photorealistic image", "Keep proportions, layout, lighting and furniture placement exactly as in the original design"),
        ("Add realism", "✨", "technical", "Make this render photorealistic, add shadows, contrast light, enhance textures", "maintain original composition and scene layout"),
        ("Blueprints", "📋", "technical", "Create technical drawings of this object", "white lines on blue background, precise architectural blueprint style, measurements"),
        ("Reconstruction", "🧩", "technical", "Complete photo reconstruction: fill in missing or damaged parts using matching material texture and logic. Restore damaged windows and walls, maintaining consistent smooth natural daylight lighting", "professional real estate photo restoration, photorealistic, 4K"),
        # Artistic
        ("Make sketch", "✏", "artistic", "Convert the photo into a pencil sketch", "hand-drawn pencil sketch style, clean lines, artistic"),
        ("Closeup", "🔍", "artistic", "Create a beautiful closeup shot showing one of the details of this image, use depth of field to blur, add bokeh, show details on focus", ""),
        ("Make brighter", "💡", "artistic", "Make a little bit brighter", "maintain original composition, natural light enhancement"),
    ]
    conn.executemany(
        "INSERT INTO presets (name, icon, effect_group, prompt_prefix, prompt_suffix, model, is_default) VALUES (?,?,?,?,?,?,?)",
        [(n, i, g, p, s, "nano-banana-pro", 1) for n, i, g, p, s in presets]
    )
    conn.commit()
    conn.close()


def get_presets(group: str = None) -> list:
    """Return presets, optionally filtered by effect_group."""
    conn = get_conn()
    if group:
        rows = conn.execute("SELECT * FROM presets WHERE effect_group=? ORDER BY id", (group,)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM presets ORDER BY effect_group, id").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_preset_groups() -> list:
    """Return distinct effect_group names."""
    conn = get_conn()
    rows = conn.execute("SELECT DISTINCT effect_group FROM presets ORDER BY effect_group").fetchall()
    conn.close()
    return [r[0] for r in rows]


# ─── Helpers ─────────────────────────────────────

def save_task(task_id: str, data: dict):
    conn = get_conn()
    from datetime import datetime
    task_type = str(data.get("task_type", "video") or "video").strip().lower()
    gen_mode = str(data.get("gen_mode", "img2vid") or "img2vid").strip().lower()
    if task_type in {"image", "image_edit"} or gen_mode == "image_edit":
        media_type = "image"
    elif task_type in {"audio", "music", "sound"} or gen_mode in {"audio", "txt2audio", "speech"}:
        media_type = "audio"
    else:
        media_type = "video"
    staff_id = str(data.get("staff_id") or data.get("user_name") or "").strip()
    session_id = str(data.get("session_id") or data.get("work_task_id") or "").strip()
    product_code = str(data.get("product_code") or "").strip()
    model_id = str(data.get("model_id") or "").strip()
    model_label = str(data.get("model_label") or "").strip()
    cost_unit = str(data.get("cost_unit") or "").strip()
    params = (
        task_id,
        data.get("batch_id", ""),
        data.get("user_name", ""),
        data.get("user_display", ""),
        data.get("status", "pending"),
        data.get("prompt", ""),
        data.get("gen_mode", "img2vid"),
        data.get("duration", 5),
        data.get("aspect_ratio", "16:9"),
        data.get("camera_move", ""),
        data.get("credit_used", 0),
        datetime.now().isoformat(),
        data.get("provider", "provider1"),
        data.get("output_filename", ""),
        data.get("source_url", ""),
        data.get("task_type", "video"),
        product_code,
        media_type,
        staff_id,
        session_id,
        model_id,
        model_label,
        cost_unit,
    )
    if conn.sqlite_mode:
        conn.execute(
            """INSERT OR REPLACE INTO tasks
            (task_id, batch_id, user_name, user_display, status, prompt, gen_mode, duration, aspect_ratio, camera_move, credit_used, created_at, provider, output_filename, source_url, task_type, product_code, media_type, staff_id, session_id, model_id, model_label, cost_unit)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            params,
        )
    else:
        conn.execute(
            """INSERT INTO tasks
            (task_id, batch_id, user_name, user_display, status, prompt, gen_mode, duration, aspect_ratio, camera_move, credit_used, created_at, provider, output_filename, source_url, task_type, product_code, media_type, staff_id, session_id, model_id, model_label, cost_unit)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT (task_id) DO UPDATE SET
                batch_id=EXCLUDED.batch_id,
                user_name=EXCLUDED.user_name,
                user_display=EXCLUDED.user_display,
                status=EXCLUDED.status,
                prompt=EXCLUDED.prompt,
                gen_mode=EXCLUDED.gen_mode,
                duration=EXCLUDED.duration,
                aspect_ratio=EXCLUDED.aspect_ratio,
                camera_move=EXCLUDED.camera_move,
                credit_used=EXCLUDED.credit_used,
                created_at=EXCLUDED.created_at,
                provider=EXCLUDED.provider,
                output_filename=EXCLUDED.output_filename,
                source_url=EXCLUDED.source_url,
                task_type=EXCLUDED.task_type,
                product_code=EXCLUDED.product_code,
                media_type=EXCLUDED.media_type,
                staff_id=EXCLUDED.staff_id,
                session_id=EXCLUDED.session_id,
                model_id=EXCLUDED.model_id,
                model_label=EXCLUDED.model_label,
                cost_unit=EXCLUDED.cost_unit""",
            params,
        )
    conn.commit()
    conn.close()


def get_task_provider(task_id: str) -> str:
    """Get the provider ID for a task. Returns None if not found."""
    conn = get_conn()
    try:
        row = conn.execute("SELECT provider FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        return dict(row).get("provider") if row else None
    except Exception:
        return None
    finally:
        conn.close()


def update_task(task_id: str, **kw):
    conn = get_conn()
    sets = ", ".join(f"{k}=?" for k in kw)
    vals = list(kw.values()) + [task_id]
    conn.execute(f"UPDATE tasks SET {sets} WHERE task_id=?", vals)
    conn.commit()
    conn.close()


def get_task(task_id: str):
    conn = get_conn()
    row = conn.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def get_tasks_by_batch(batch_id: str):
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM tasks WHERE batch_id=? ORDER BY id ASC",
        (batch_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_history(limit=50):
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM tasks ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def add_notification(user_id: str, ntype: str, title: str, body: str, data: dict = None):
    import json
    conn = get_conn()
    conn.execute(
        "INSERT INTO notifications (id, user_id, type, title, body, data_json, created_at) VALUES (?,?,?,?,?,?,?)",
        (str(uuid.uuid4()), user_id, ntype, title, body, json.dumps(data or {}), time.time())
    )
    conn.commit()
    conn.close()


def get_notifications(user_id: str, unread_only=True):
    conn = get_conn()
    if unread_only:
        rows = conn.execute(
            "SELECT * FROM notifications WHERE user_id=? AND read=0 ORDER BY created_at DESC LIMIT 50",
            (user_id,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
            (user_id,)
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def mark_notification_read(nid: str):
    conn = get_conn()
    conn.execute("UPDATE notifications SET read=1 WHERE id=?", (nid,))
    conn.commit()
    conn.close()


def notify_admins(ntype: str, title: str, body: str, data: dict = None):
    """Send notification to all admin users."""
    conn = get_conn()
    admins = conn.execute("SELECT id FROM users WHERE role='admin' AND active=1").fetchall()
    conn.close()
    for a in admins:
        add_notification(a["id"], ntype, title, body, data)


def get_active_tasks(user_name: str = None) -> list:
    """Get tasks that are currently processing."""
    conn = get_conn()
    if user_name:
        rows = conn.execute(
            "SELECT * FROM tasks WHERE status IN ('pending','processing') AND user_name=? ORDER BY id DESC",
            (user_name,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM tasks WHERE status IN ('pending','processing') ORDER BY id DESC"
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_live_presence(user_name: str):
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM live_presence WHERE user_name=? LIMIT 1",
        (user_name,),
    ).fetchone()
    conn.close()
    if not row:
        return None
    item = dict(row)
    try:
        item["current_entries"] = json.loads(str(item.get("current_entries_json") or "[]"))
    except Exception:
        item["current_entries"] = []
    try:
        item["announced_codes"] = json.loads(str(item.get("announced_codes_json") or "[]"))
    except Exception:
        item["announced_codes"] = []
    return item


def upsert_live_presence(data: dict):
    user_name = str(data.get("user_name") or "").strip()
    if not user_name:
        return
    current_entries = data.get("current_entries") or []
    announced_codes = data.get("announced_codes") or []
    conn = get_conn()
    params = (
        user_name,
        str(data.get("display_name") or "").strip(),
        str(data.get("role") or "staff").strip() or "staff",
        str(data.get("current_code") or "").strip(),
        str(data.get("current_task") or "").strip(),
        json.dumps(current_entries, ensure_ascii=False),
        float(data.get("shift_started_at") or 0),
        float(data.get("online_since") or 0),
        float(data.get("last_seen") or 0),
        int(data.get("active_tasks") or 0),
        json.dumps(announced_codes, ensure_ascii=False),
    )
    if conn.sqlite_mode:
        conn.execute(
            """
            INSERT OR REPLACE INTO live_presence
            (user_name, display_name, role, current_code, current_task, current_entries_json, shift_started_at, online_since, last_seen, active_tasks, announced_codes_json)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
            """,
            params,
        )
    else:
        conn.execute(
            """
            INSERT INTO live_presence
            (user_name, display_name, role, current_code, current_task, current_entries_json, shift_started_at, online_since, last_seen, active_tasks, announced_codes_json)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT (user_name) DO UPDATE SET
                display_name=EXCLUDED.display_name,
                role=EXCLUDED.role,
                current_code=EXCLUDED.current_code,
                current_task=EXCLUDED.current_task,
                current_entries_json=EXCLUDED.current_entries_json,
                shift_started_at=EXCLUDED.shift_started_at,
                online_since=EXCLUDED.online_since,
                last_seen=EXCLUDED.last_seen,
                active_tasks=EXCLUDED.active_tasks,
                announced_codes_json=EXCLUDED.announced_codes_json
            """,
            params,
        )
    conn.commit()
    conn.close()


def list_live_presence(max_age_seconds: int = 60) -> list:
    now_ts = float(time.time())
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM live_presence WHERE COALESCE(last_seen,0) >= ? ORDER BY last_seen DESC",
        (now_ts - max(1, int(max_age_seconds)),),
    ).fetchall()
    conn.close()
    out = []
    for row in rows or []:
        item = dict(row)
        try:
            item["current_entries"] = json.loads(str(item.get("current_entries_json") or "[]"))
        except Exception:
            item["current_entries"] = []
        try:
            item["announced_codes"] = json.loads(str(item.get("announced_codes_json") or "[]"))
        except Exception:
            item["announced_codes"] = []
        out.append(item)
    return out


def create_input_asset(data: dict) -> str:
    aid = str(uuid.uuid4())
    now_ts = float(time.time())
    conn = get_conn()
    conn.execute(
        """
        INSERT INTO input_assets
        (id, user_id, user_name, user_display, session_id, code_tag, folder_name, file_name, mime_type, source_url, width, height, edited, derived_from_asset_id, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            aid,
            str(data.get("user_id") or "").strip(),
            str(data.get("user_name") or "").strip(),
            str(data.get("user_display") or "").strip(),
            str(data.get("session_id") or "").strip(),
            str(data.get("code_tag") or "").strip(),
            str(data.get("folder_name") or "").strip(),
            str(data.get("file_name") or "").strip(),
            str(data.get("mime_type") or "").strip(),
            str(data.get("source_url") or "").strip(),
            int(data.get("width") or 0),
            int(data.get("height") or 0),
            int(1 if data.get("edited") else 0),
            str(data.get("derived_from_asset_id") or "").strip(),
            now_ts,
            now_ts,
        ),
    )
    conn.commit()
    conn.close()
    return aid


def list_input_assets(user_name: str = "", session_id: str = "", code_tag: str = "", limit: int = 300) -> list:
    conn = get_conn()
    query = "SELECT * FROM input_assets"
    clauses = []
    params = []
    if user_name:
        clauses.append("user_name=?")
        params.append(str(user_name))
    if session_id:
        clauses.append("session_id=?")
        params.append(str(session_id))
    if code_tag:
        clauses.append("code_tag=?")
        params.append(str(code_tag))
    if clauses:
        query += " WHERE " + " AND ".join(clauses)
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(max(1, int(limit)))
    rows = conn.execute(query, tuple(params)).fetchall()
    conn.close()
    return [dict(row) for row in rows]


def get_input_asset(asset_id: str):
    conn = get_conn()
    row = conn.execute("SELECT * FROM input_assets WHERE id=? LIMIT 1", (asset_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def update_input_asset(asset_id: str, updates: dict):
    clean = {k: v for k, v in (updates or {}).items() if k in {
        "session_id",
        "code_tag",
        "folder_name",
        "file_name",
        "mime_type",
        "source_url",
        "width",
        "height",
        "edited",
        "derived_from_asset_id",
    }}
    if not clean:
        return
    clean["updated_at"] = float(time.time())
    sets = ", ".join(f"{k}=?" for k in clean.keys())
    params = list(clean.values()) + [asset_id]
    conn = get_conn()
    conn.execute(f"UPDATE input_assets SET {sets} WHERE id=?", tuple(params))
    conn.commit()
    conn.close()


def delete_input_asset(asset_id: str):
    conn = get_conn()
    conn.execute("DELETE FROM input_assets WHERE id=?", (asset_id,))
    conn.commit()
    conn.close()


def save_shift_report(data: dict):
    conn = get_conn()
    conn.execute(
        "INSERT INTO shift_reports (id, user_id, user_name, user_display, total_tasks, total_credits, notes, submitted_at) VALUES (?,?,?,?,?,?,?,?)",
        (str(uuid.uuid4()), data["user_id"], data["user_name"], data["user_display"],
         data.get("total_tasks", 0), data.get("total_credits", 0),
         data.get("notes", ""), time.time())
    )
    conn.commit()
    conn.close()


def get_shift_reports(limit=50) -> list:
    conn = get_conn()
    rows = conn.execute("SELECT * FROM shift_reports ORDER BY submitted_at DESC LIMIT ?", (limit,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def save_ai_chat_history(user_name: str, session_key: str, data: dict):
    conn = get_conn()
    now_ts = time.time()
    exists = conn.execute(
        "SELECT id FROM ai_chat_history WHERE user_name=? AND session_key=?",
        (user_name, session_key),
    ).fetchone()
    if exists:
        conn.execute(
            """
            UPDATE ai_chat_history
            SET work_task_id=?, chat_model=?, chat_skill=?, system_prompt=?, messages_json=?,
                analyze_model=?, analyze_skill=?, analyze_system_prompt=?, analyze_prompt=?, analyze_file_name=?, analyze_result_json=?,
                updated_at=?
            WHERE user_name=? AND session_key=?
            """,
            (
                data.get("work_task_id", "") or "",
                data.get("chat_model", "gpt-5-4") or "gpt-5-4",
                data.get("chat_skill", "") or "",
                data.get("system_prompt", "") or "",
                json.dumps(data.get("messages") or [], ensure_ascii=False),
                data.get("analyze_model", "gpt-5-4") or "gpt-5-4",
                data.get("analyze_skill", "") or "",
                data.get("analyze_system_prompt", "") or "",
                data.get("analyze_prompt", "") or "",
                data.get("analyze_file_name", "") or "",
                json.dumps(data.get("analyze_result") or {}, ensure_ascii=False),
                now_ts,
                user_name,
                session_key,
            ),
        )
    else:
        conn.execute(
            """
            INSERT INTO ai_chat_history
            (user_name, session_key, work_task_id, chat_model, chat_skill, system_prompt, messages_json,
             analyze_model, analyze_skill, analyze_system_prompt, analyze_prompt, analyze_file_name, analyze_result_json,
             updated_at, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                user_name,
                session_key,
                data.get("work_task_id", "") or "",
                data.get("chat_model", "gpt-5-4") or "gpt-5-4",
                data.get("chat_skill", "") or "",
                data.get("system_prompt", "") or "",
                json.dumps(data.get("messages") or [], ensure_ascii=False),
                data.get("analyze_model", "gpt-5-4") or "gpt-5-4",
                data.get("analyze_skill", "") or "",
                data.get("analyze_system_prompt", "") or "",
                data.get("analyze_prompt", "") or "",
                data.get("analyze_file_name", "") or "",
                json.dumps(data.get("analyze_result") or {}, ensure_ascii=False),
                now_ts,
                now_ts,
            ),
        )
    conn.commit()
    conn.close()


def get_ai_chat_history(user_name: str, session_key: str):
    conn = get_conn()
    row = conn.execute(
        """
        SELECT user_name, session_key, work_task_id, chat_model, chat_skill, system_prompt, messages_json,
               analyze_model, analyze_skill, analyze_system_prompt, analyze_prompt, analyze_file_name, analyze_result_json,
               updated_at, created_at
        FROM ai_chat_history
        WHERE user_name=? AND session_key=?
        LIMIT 1
        """,
        (user_name, session_key),
    ).fetchone()
    conn.close()
    if not row:
        return None
    data = dict(row)
    try:
        data["messages"] = json.loads(data.get("messages_json") or "[]")
    except Exception:
        data["messages"] = []
    data.pop("messages_json", None)
    try:
        data["analyze_result"] = json.loads(data.get("analyze_result_json") or "{}")
    except Exception:
        data["analyze_result"] = {}
    data.pop("analyze_result_json", None)
    return data


def list_ai_chat_histories(user_name: str, limit: int = 100):
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT session_key, work_task_id, chat_skill, chat_model, messages_json, updated_at, created_at
        FROM ai_chat_history
        WHERE user_name=?
        ORDER BY updated_at DESC, id DESC
        LIMIT ?
        """,
        (user_name, int(limit or 100)),
    ).fetchall()
    conn.close()
    out = []
    for row in rows or []:
        item = dict(row)
        preview = ""
        try:
            messages = json.loads(item.get("messages_json") or "[]")
            for msg in reversed(messages):
                if str(msg.get("role") or "") == "user":
                    preview = str(msg.get("content") or "").strip()
                    break
            item["message_count"] = len(messages)
        except Exception:
            item["message_count"] = 0
        item["preview"] = preview[:140]
        item.pop("messages_json", None)
        out.append(item)
    return out


def delete_ai_chat_history(user_name: str, session_key: str):
    conn = get_conn()
    conn.execute(
        "DELETE FROM ai_chat_history WHERE user_name=? AND session_key=?",
        (user_name, session_key),
    )
    conn.execute(
        "DELETE FROM ai_chat_memories WHERE user_name=? AND session_key=?",
        (user_name, session_key),
    )
    conn.execute(
        "DELETE FROM ai_chat_analysis_records WHERE user_name=? AND session_key=?",
        (user_name, session_key),
    )
    conn.commit()
    conn.close()


def save_ai_chat_memory(user_name: str, session_key: str, data: dict):
    conn = get_conn()
    now_ts = time.time()
    exists = conn.execute(
        "SELECT id FROM ai_chat_memories WHERE user_name=? AND session_key=?",
        (user_name, session_key),
    ).fetchone()
    if exists:
        conn.execute(
            """
            UPDATE ai_chat_memories
            SET work_task_id=?, memory_text=?, updated_at=?
            WHERE user_name=? AND session_key=?
            """,
            (
                data.get("work_task_id", "") or "",
                data.get("memory_text", "") or "",
                now_ts,
                user_name,
                session_key,
            ),
        )
    else:
        conn.execute(
            """
            INSERT INTO ai_chat_memories
            (user_name, session_key, work_task_id, memory_text, updated_at, created_at)
            VALUES (?,?,?,?,?,?)
            """,
            (
                user_name,
                session_key,
                data.get("work_task_id", "") or "",
                data.get("memory_text", "") or "",
                now_ts,
                now_ts,
            ),
        )
    conn.commit()
    conn.close()


def get_ai_chat_memory(user_name: str, session_key: str):
    conn = get_conn()
    row = conn.execute(
        """
        SELECT user_name, session_key, work_task_id, memory_text, updated_at, created_at
        FROM ai_chat_memories
        WHERE user_name=? AND session_key=?
        LIMIT 1
        """,
        (user_name, session_key),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def rebuild_ai_chat_memory(user_name: str, session_key: str):
    row = get_ai_chat_history(user_name, session_key) or {}
    messages = [m for m in (row.get("messages") or []) if str(m.get("role") or "") in {"user", "assistant"}]
    messages = messages[-12:]
    lines = []
    user_count = 0
    assistant_count = 0
    for msg in messages:
        role = str(msg.get("role") or "")
        content = " ".join(str(msg.get("content") or "").split())
        if not content:
            continue
        if len(content) > 160:
            content = content[:157] + "..."
        if role == "user":
            user_count += 1
            lines.append(f"- User intent {user_count}: {content}")
        elif role == "assistant":
            assistant_count += 1
            lines.append(f"- AI output {assistant_count}: {content}")
    memory_text = "\n".join(lines).strip()
    save_ai_chat_memory(
        user_name,
        session_key,
        {
            "work_task_id": row.get("work_task_id", "") or "",
            "memory_text": memory_text,
        },
    )
    return get_ai_chat_memory(user_name, session_key) or {"memory_text": memory_text}


def add_ai_chat_analysis_record(user_name: str, session_key: str, data: dict):
    conn = get_conn()
    conn.execute(
        """
        INSERT INTO ai_chat_analysis_records
        (user_name, session_key, work_task_id, analyze_model, analyze_skill, analyze_system_prompt, analyze_prompt, analyze_file_name, analysis_json, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        """,
        (
            user_name,
            session_key,
            data.get("work_task_id", "") or "",
            data.get("analyze_model", "gpt-5-4") or "gpt-5-4",
            data.get("analyze_skill", "") or "",
            data.get("analyze_system_prompt", "") or "",
            data.get("analyze_prompt", "") or "",
            data.get("analyze_file_name", "") or "",
            json.dumps(data.get("analysis_result") or {}, ensure_ascii=False),
            time.time(),
        ),
    )
    conn.commit()
    conn.close()


def get_user_task_stats(user_name: str) -> dict:
    """Get current shift stats for a user (tasks created today, credits used)."""
    conn = get_conn()
    from datetime import datetime
    today = datetime.now().strftime("%Y-%m-%d")
    row = conn.execute(
        "SELECT COUNT(*) as cnt, COALESCE(SUM(credit_used),0) as total FROM tasks WHERE user_name=? AND created_at LIKE ?",
        (user_name, f"{today}%")
    ).fetchone()
    conn.close()
    return {"total_tasks": row["cnt"], "total_credits": row["total"]}


def _coerce_ts(value) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return 0.0
    try:
        return float(text)
    except Exception:
        pass
    try:
        import datetime as _dt
        return _dt.datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def get_shift_report_summary(user_name: str):
    conn = get_conn()
    last_report = conn.execute(
        "SELECT submitted_at FROM shift_reports WHERE user_name=? ORDER BY submitted_at DESC LIMIT 1",
        (user_name,),
    ).fetchone()
    shift_start = float(last_report["submitted_at"] or 0) if last_report else 0.0

    work_task_rows = conn.execute(
        "SELECT * FROM work_tasks WHERE user_name=? ORDER BY created_at ASC",
        (user_name,),
    ).fetchall()
    task_rows = conn.execute(
        """
        SELECT task_id, work_task_id, prompt, status, gen_mode, credit_used, created_at, completed_at, result_url
        FROM tasks
        WHERE user_name=?
        ORDER BY id ASC
        """,
        (user_name,),
    ).fetchall()
    conn.close()

    work_tasks_all = [dict(r) for r in work_task_rows]
    tasks_all = [dict(r) for r in task_rows]

    shift_work_tasks = []
    shift_work_task_ids = set()
    user_display = user_name
    for wt in work_tasks_all:
        created_ts = _coerce_ts(wt.get("created_at"))
        closed_ts = _coerce_ts(wt.get("closed_at"))
        if created_ts >= shift_start or (closed_ts and closed_ts >= shift_start):
            shift_work_tasks.append(wt)
            shift_work_task_ids.add(str(wt.get("id") or ""))
            user_display = wt.get("user_display") or wt.get("user_name") or user_display

    shift_tasks = []
    for task in tasks_all:
        work_task_id = str(task.get("work_task_id") or "")
        if work_task_id and work_task_id in shift_work_task_ids:
            shift_tasks.append(task)

    success_count = sum(1 for t in shift_tasks if str(t.get("status") or "") == "success")
    fail_count = sum(1 for t in shift_tasks if str(t.get("status") or "") in {"fail", "failed", "error", "cancelled"})
    pending_count = max(len(shift_tasks) - success_count - fail_count, 0)
    total_credits = float(sum(float(t.get("credit_used", 0) or 0) for t in shift_tasks))
    video_success_count = sum(
        1
        for t in shift_tasks
        if str(t.get("status") or "") == "success"
        and str(t.get("gen_mode") or "").lower() in {"img2vid", "frames", "video", "batch_video"}
    )
    image_success_count = sum(
        1
        for t in shift_tasks
        if str(t.get("status") or "") == "success"
        and str(t.get("gen_mode") or "").lower() in {"image_edit", "image", "batch_image"}
    )

    return {
        "shift": {
            "user_name": user_name,
            "user_display": user_display,
            "start_at": shift_start,
            "end_at": time.time(),
        },
        "work_tasks": shift_work_tasks,
        "tasks": shift_tasks,
        "summary": {
            "total_tasks": len(shift_tasks),
            "success_count": success_count,
            "fail_count": fail_count,
            "pending_count": pending_count,
            "total_credits": total_credits,
            "video_count": video_success_count,
            "image_count": image_success_count,
            "work_task_count": len(shift_work_tasks),
        },
    }


# ── Work Tasks (phiên làm việc) ──────────────────
def create_work_task(data: dict) -> str:
    wid = str(uuid.uuid4())[:12]
    conn = get_conn()
    conn.execute(
        "INSERT INTO work_tasks (id, title, description, user_name, user_display, status, created_at) VALUES (?,?,?,?,?,?,?)",
        (wid, data["title"], data.get("description", ""), data["user_name"],
         data.get("user_display", ""), "active", time.time())
    )
    conn.commit()
    conn.close()
    return wid


def close_work_task(wid: str, notes: str = ""):
    conn = get_conn()
    # Count videos + credits in this work task
    row = conn.execute(
        "SELECT COUNT(*) as cnt, COALESCE(SUM(credit_used),0) as cred FROM tasks WHERE work_task_id=?",
        (wid,)
    ).fetchone()
    conn.execute(
        "UPDATE work_tasks SET status='closed', closed_at=?, notes=?, video_count=?, credits_used=? WHERE id=?",
        (time.time(), notes, row["cnt"], row["cred"], wid)
    )
    conn.commit()
    conn.close()
    return {"video_count": row["cnt"], "credits_used": row["cred"]}


def get_work_task_summary(wid: str):
    conn = get_conn()
    work_task = conn.execute(
        "SELECT * FROM work_tasks WHERE id=?",
        (wid,),
    ).fetchone()
    if not work_task:
        conn.close()
        return None

    task_rows = conn.execute(
        """
        SELECT task_id, prompt, status, gen_mode, credit_used, created_at, completed_at, result_url
        FROM tasks
        WHERE work_task_id=?
        ORDER BY id ASC
        """,
        (wid,),
    ).fetchall()
    conn.close()

    work_task_data = dict(work_task)
    tasks = [dict(r) for r in task_rows]
    success_count = sum(1 for t in tasks if t.get("status") == "success")
    fail_count = sum(1 for t in tasks if t.get("status") in {"fail", "failed", "error", "cancelled"})
    pending_count = max(len(tasks) - success_count - fail_count, 0)
    return {
        "work_task": work_task_data,
        "tasks": tasks,
        "summary": {
            "total_tasks": len(tasks),
            "success_count": success_count,
            "fail_count": fail_count,
            "pending_count": pending_count,
            "total_credits": float(sum(float(t.get("credit_used", 0) or 0) for t in tasks)),
            "video_count": int(work_task_data.get("video_count", 0) or 0),
        },
    }


def get_work_tasks(user_name: str = None, status: str = None, limit=50) -> list:
    conn = get_conn()
    q = "SELECT * FROM work_tasks"
    params = []
    clauses = []
    if user_name:
        clauses.append("user_name=?"); params.append(user_name)
    if status:
        clauses.append("status=?"); params.append(status)
    if clauses:
        q += " WHERE " + " AND ".join(clauses)
    q += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    rows = conn.execute(q, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_active_work_task(user_name: str):
    """Get the currently active work task for a user (max 1)."""
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM work_tasks WHERE user_name=? AND status='active' ORDER BY created_at DESC LIMIT 1",
        (user_name,)
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def link_video_to_work_task(task_id: str, work_task_id: str):
    conn = get_conn()
    wt = conn.execute(
        "SELECT id, title, user_name FROM work_tasks WHERE id=? LIMIT 1",
        (work_task_id,),
    ).fetchone()
    wt_data = dict(wt) if wt else {}
    conn.execute(
        "UPDATE tasks SET work_task_id=?, session_id=?, product_code=COALESCE(NULLIF(product_code,''), ?), staff_id=COALESCE(NULLIF(staff_id,''), ?) WHERE task_id=?",
        (
            work_task_id,
            work_task_id,
            str(wt_data.get("title") or ""),
            str(wt_data.get("user_name") or ""),
            task_id,
        ),
    )
    conn.commit()
    conn.close()
