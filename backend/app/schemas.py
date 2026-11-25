from pydantic import BaseModel, Field, field_validator


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=80, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=72)


class TestCase(BaseModel):
    input: str = Field(min_length=1, max_length=10000)
    expected: str = Field(default="", max_length=5000)


class ExperimentCreate(BaseModel):
    prompt: str = Field(min_length=1, max_length=50000)
    protected_spans: list[str] = Field(default_factory=list, max_length=100)
    test_cases: list[TestCase] = Field(default_factory=list, max_length=20)
    model: str = Field(default="gpt-4o-mini", min_length=1, max_length=100)
    threshold: float = Field(default=95, ge=50, le=100)
    input_price: float = Field(default=0, ge=0, le=100000)
    output_price: float = Field(default=0, ge=0, le=100000)

    @field_validator("protected_spans")
    @classmethod
    def spans_must_exist(cls, spans, info):
        prompt = info.data.get("prompt", "")
        if any(not span.strip() or span not in prompt for span in spans):
            raise ValueError("Every protected span must be non-empty text present in the prompt.")
        return list(dict.fromkeys(spans))


class TestRun(BaseModel):
    variant_index: int = Field(ge=0, le=2)


class RoleUpdate(BaseModel):
    role: str = Field(pattern=r"^(admin|analyst|viewer)$")


class ApplicationSettingsUpdate(BaseModel):
    default_model: str = Field(min_length=1, max_length=100)
    default_threshold: float = Field(ge=50, le=100)
    input_price: float = Field(ge=0, le=100000)
    output_price: float = Field(ge=0, le=100000)
