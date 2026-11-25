from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

from .config import settings


ALGORITHM = "HS256"
passwords = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return passwords.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return passwords.verify(password, password_hash)


def create_access_token(user_id: int) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    return jwt.encode({"sub": str(user_id), "exp": expires}, settings.jwt_secret, algorithm=ALGORITHM)


def get_token_subject(token: str) -> int | None:
    try:
        return int(jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])["sub"])
    except (JWTError, KeyError, ValueError):
        return None
