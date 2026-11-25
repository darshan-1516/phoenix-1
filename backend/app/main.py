from datetime import datetime, timedelta, timezone
from statistics import mean

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from .config import settings
from .database import Base, SessionLocal, engine, get_db
from .models import AppSetting, Experiment, User, utc_now
from .schemas import ApplicationSettingsUpdate, Credentials, ExperimentCreate, RoleUpdate, TestRun
from .security import create_access_token, get_token_subject, hash_password, verify_password
from .services import compare_outputs, generate_variants, token_count


Base.metadata.create_all(bind=engine)
if settings.admin_username and settings.admin_password:
    with SessionLocal() as bootstrap_db:
        bootstrap_user = bootstrap_db.scalar(select(User).where(User.username == settings.admin_username))
        if bootstrap_user is None:
            bootstrap_user = User(
                username=settings.admin_username,
                password_hash=hash_password(settings.admin_password),
                role="admin",
            )
            bootstrap_db.add(bootstrap_user)
        else:
            bootstrap_user.role = "admin"
        bootstrap_db.commit()
app = FastAPI(title="PromptGuard API", version="1.0.0", description="Prompt compression with empirical equivalence verification.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

bearer = HTTPBearer(auto_error=False)


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    user_id = get_token_subject(credentials.credentials) if credentials else None
    user = db.get(User, user_id) if user_id else None
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="A valid login is required.")
    return user


def require_analyst(user: User = Depends(current_user)) -> User:
    if user.role not in {"analyst", "admin"}:
        raise HTTPException(status_code=403, detail="Viewer accounts can review runs but cannot create or test experiments.")
    return user


def experiment_dict(item: Experiment) -> dict:
    return {
        "id": item.id,
        "title": item.title,
        "original_prompt": item.original_prompt,
        "protected_spans": item.protected_spans,
        "test_cases": item.test_cases,
        "variants": item.variants,
        "model": item.model,
        "threshold": item.threshold,
        "input_price": item.input_price,
        "output_price": item.output_price,
        "compression_mode": item.compression_mode,
        "original_token_count": item.original_token_count,
        "compressed_token_count": item.compressed_token_count,
        "tokens_saved": item.tokens_saved,
        "compression_pct": item.compression_pct,
        "equivalence_score": item.equivalence_score,
        "rule_score": item.rule_score,
        "decision": item.decision,
        "cost_saved": item.cost_saved,
        "result": item.result,
        "created_at": item.created_at.isoformat(),
    }


@app.get("/api/health")
def health():
    return {"status": "ok", "llm_configured": bool(settings.openai_api_key)}


@app.post("/api/auth/register", status_code=201)
def register(payload: Credentials, db: Session = Depends(get_db)):
    existing = db.scalar(select(User).where(User.username == payload.username))
    if existing:
        raise HTTPException(status_code=409, detail="That username is already registered.")
    user = User(username=payload.username, password_hash=hash_password(payload.password), role="analyst")
    db.add(user)
    db.commit()
    return {"id": user.id, "username": user.username, "role": user.role}


@app.post("/api/auth/login")
def login(payload: Credentials, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == payload.username))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect username or password.")
    return {"access_token": create_access_token(user.id), "token_type": "bearer"}


@app.get("/api/auth/me")
def me(user: User = Depends(current_user)):
    return {"id": user.id, "username": user.username, "role": user.role}


DEFAULT_APP_SETTINGS = {
    "default_model": "gpt-4o-mini",
    "default_threshold": 95.0,
    "input_price": 0.0,
    "output_price": 0.0,
}


def app_settings_payload(db: Session) -> dict:
    record = db.get(AppSetting, "defaults")
    return {**DEFAULT_APP_SETTINGS, **(record.value if record else {})}


@app.get("/api/settings")
def get_app_settings(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return app_settings_payload(db)


@app.get("/api/admin/settings")
def get_admin_settings(db: Session = Depends(get_db), user: User = Depends(current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required.")
    return app_settings_payload(db)


@app.put("/api/admin/settings")
def update_app_settings(
    payload: ApplicationSettingsUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required.")
    record = db.get(AppSetting, "defaults")
    values = payload.model_dump()
    if record is None:
        record = AppSetting(key="defaults", value=values)
        db.add(record)
    else:
        record.value = values
    db.commit()
    return values


@app.get("/api/admin/users")
def users(db: Session = Depends(get_db), user: User = Depends(current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required.")
    return [{"id": row.id, "username": row.username, "role": row.role} for row in db.scalars(select(User).order_by(User.id))]


@app.patch("/api/admin/users/{user_id}/role")
def update_user_role(
    user_id: int,
    payload: RoleUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required.")
    if user_id == user.id and payload.role != "admin":
        raise HTTPException(status_code=409, detail="You cannot remove your own admin role.")
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    target.role = payload.role
    db.commit()
    return {"id": target.id, "username": target.username, "role": target.role}


@app.post("/api/experiments", status_code=201)
async def create_experiment(payload: ExperimentCreate, db: Session = Depends(get_db), user: User = Depends(require_analyst)):
    if not payload.test_cases:
        raise HTTPException(status_code=422, detail="Add at least one test case before creating an experiment.")
    try:
        variants, compression_mode = await generate_variants(
            payload.prompt, payload.protected_spans, payload.model,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    original_count = token_count(payload.prompt)
    item = Experiment(
        user_id=user.id,
        title=payload.prompt.strip().splitlines()[0][:157] or "Prompt experiment",
        original_prompt=payload.prompt,
        protected_spans=payload.protected_spans,
        test_cases=[case.model_dump() for case in payload.test_cases],
        variants=variants,
        model=payload.model,
        threshold=payload.threshold,
        input_price=payload.input_price,
        output_price=payload.output_price,
        compression_mode=compression_mode,
        original_token_count=original_count,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return experiment_dict(item)


@app.get("/api/experiments")
def list_experiments(db: Session = Depends(get_db), user: User = Depends(current_user)):
    query = select(Experiment).order_by(desc(Experiment.created_at))
    if user.role != "admin":
        query = query.where(Experiment.user_id == user.id)
    return [experiment_dict(item) for item in db.scalars(query.limit(200))]


@app.get("/api/experiments/{experiment_id}")
def get_experiment(experiment_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.get(Experiment, experiment_id)
    if not item or (user.role != "admin" and item.user_id != user.id):
        raise HTTPException(status_code=404, detail="Experiment not found.")
    return experiment_dict(item)


@app.post("/api/experiments/{experiment_id}/test")
async def test_experiment(
    experiment_id: int,
    payload: TestRun,
    db: Session = Depends(get_db),
    user: User = Depends(require_analyst),
):
    item = db.get(Experiment, experiment_id)
    if not item or (user.role != "admin" and item.user_id != user.id):
        raise HTTPException(status_code=404, detail="Experiment not found.")
    if payload.variant_index >= len(item.variants):
        raise HTTPException(status_code=422, detail="That compression variant does not exist.")
    variant = item.variants[payload.variant_index]
    if any(span not in variant["prompt"] for span in item.protected_spans):
        raise HTTPException(status_code=409, detail="Protected instruction validation failed; this variant cannot be tested.")
    try:
        comparison = await compare_outputs(
            item.original_prompt, variant["prompt"], item.test_cases,
            item.model, item.protected_spans,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Output comparison failed: {exc}") from exc
    original_tokens = item.original_token_count
    compressed_tokens = variant["token_count"]
    tokens_saved = max(0, original_tokens - compressed_tokens)
    input_cost_saved = tokens_saved * len(item.test_cases) * item.input_price / 1_000_000
    outputs = comparison["comparisons"]
    output_tokens = sum(token_count(row["original_output"]) for row in outputs)
    compressed_output_tokens = sum(token_count(row["compressed_output"]) for row in outputs)
    output_cost_delta = (output_tokens - compressed_output_tokens) * item.output_price / 1_000_000
    cost_saved = input_cost_saved + output_cost_delta
    protected_intact = all(span in variant["prompt"] for span in item.protected_spans)
    decision = "ACCEPT" if comparison["equivalence_score"] >= item.threshold and protected_intact else "REJECT"
    comparison.update({
        "decision": decision,
        "threshold": item.threshold,
        "original_token_count": original_tokens,
        "compressed_token_count": compressed_tokens,
        "tokens_saved": tokens_saved,
        "compression_pct": tokens_saved / max(1, original_tokens) * 100,
        "cost_saved": cost_saved,
        "rules_passed": comparison["rule_score"] * 100 >= item.threshold,
        "original_cost": (
            original_tokens * len(item.test_cases) * item.input_price
            + output_tokens * item.output_price
        ) / 1_000_000,
        "compressed_cost": (
            compressed_tokens * len(item.test_cases) * item.input_price
            + compressed_output_tokens * item.output_price
        ) / 1_000_000,
        "protected_intact": protected_intact,
        "model": item.model,
        "variant_name": variant["name"],
        "similarity_method": comparison["similarity_method"],
    })
    item.compressed_token_count = compressed_tokens
    item.tokens_saved = tokens_saved
    item.compression_pct = comparison["compression_pct"]
    item.equivalence_score = comparison["equivalence_score"]
    item.rule_score = comparison["rule_score"]
    item.decision = decision
    item.cost_saved = cost_saved
    item.result = comparison
    item.created_at = utc_now()
    db.commit()
    return comparison


@app.get("/api/dashboard")
def dashboard(db: Session = Depends(get_db), user: User = Depends(current_user)):
    query = select(Experiment)
    if user.role != "admin":
        query = query.where(Experiment.user_id == user.id)
    experiments = list(db.scalars(query.order_by(desc(Experiment.created_at))))
    tested = [item for item in experiments if item.equivalence_score is not None]
    daily = []
    today = datetime.now(timezone.utc).date()
    for days_ago in range(6, -1, -1):
        day = today - timedelta(days=days_ago)
        day_runs = [item for item in experiments if item.created_at.date() == day]
        day_tested = [item for item in day_runs if item.equivalence_score is not None]
        daily.append({
            "date": day.strftime("%b %d"),
            "runs": len(day_runs),
            "tokens_saved": sum(item.tokens_saved for item in day_runs),
            "tokens_before": sum(item.original_token_count for item in day_tested),
            "tokens_after": sum(item.compressed_token_count or 0 for item in day_tested),
            "equivalence": mean([item.equivalence_score for item in day_tested]) if day_tested else None,
            "cost_saved": sum(item.cost_saved for item in day_runs),
        })
    return {
        "total_experiments": len(experiments),
        "tokens_saved": sum(item.tokens_saved for item in experiments),
        "average_compression": mean([item.compression_pct for item in tested]) if tested else 0,
        "average_equivalence": mean([item.equivalence_score for item in tested]) if tested else 0,
        "total_cost_saved": sum(item.cost_saved for item in experiments),
        "verified_experiments": len(tested),
        "daily_activity": daily,
    }
