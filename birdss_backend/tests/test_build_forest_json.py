"""Tests for app/scripts/build_forest_json.py — every filter parameter."""

import json
from pathlib import Path

import pytest

import build_forest_json as bfj

CSV_HEADER = (
    "gbifID\tcountryCode\tlocality\tstateProvince\tspecies\t"
    "scientificName\tindividualCount\tyear\tdecimalLatitude\tdecimalLongitude\n"
)
CSV_ROWS = [
    "1\tNP\tKathmandu\tBagmati\tLophophorus impejanus\t"
    "Lophophorus impejanus (Latham, 1790)\t2\t2024\t28.1\t85.5\n",
    "2\tNP\tPokhara\tGandaki\tCorvus splendens\tCorvus splendens\t1\t2020\t28.2\t83.9\n",
    "3\tIN\tDelhi\tDelhi\tLophophorus impejanus\t"
    "Lophophorus impejanus (Latham, 1790)\t0\t2019\t28.6\t77.2\n",
    "4\tNP\tKathmandu hills\tBagmati\tMilvus migrans\t"
    "Milvus migrans (Boddaert, 1783)\t5\t2022\t27.7\t85.4\n",
]
EXPECTED_OUTPUT_KEYS = {
    "species",
    "scientificName",
    "locality",
    "stateProvince",
    "countryCode",
    "year",
    "individualCount",
    "coordinates",
    "order",
    "family",
}


@pytest.fixture
def sample_csv(tmp_path: Path) -> Path:
    path = tmp_path / "sample.csv"
    path.write_text(CSV_HEADER + "".join(CSV_ROWS), encoding="utf-8")
    return path


@pytest.fixture
def rows(sample_csv: Path) -> list[dict[str, str]]:
    return bfj.read_csv_rows(str(sample_csv))


@pytest.fixture(autouse=True)
def skip_download(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bfj, "ensure_dataset", lambda _path: None)


class TestNormalizeFilters:
    def test_api_aliases(self):
        raw = {
            "country": "NP",
            "state": "Bagmati",
            "min_count": 2,
            "area-field": "locality",
        }
        assert bfj.normalize_filters(raw) == {
            "countryCode": "NP",
            "stateProvince": "Bagmati",
            "min_individual_count": 2,
            "area_field": "locality",
        }


class TestLoadParams:
    def test_json_file(self, tmp_path: Path):
        path = tmp_path / "filters.json"
        path.write_text(
            json.dumps({"countryCode": "NP", "limit": 10}),
            encoding="utf-8",
        )
        assert bfj.load_params_json(str(path)) == {"countryCode": "NP", "limit": 10}

    def test_inline_json(self):
        assert bfj.load_params_json('{"species": "Corvus", "limit": 5}') == {
            "species": "Corvus",
            "limit": 5,
        }

    def test_loose_powershell_style(self):
        parsed = bfj.load_params_json("{countryCode:NP,species:Corvus splendens,limit:2}")
        assert parsed == {"countryCode": "NP", "species": "Corvus splendens", "limit": 2}


class TestFilterParameters:
    def test_country_code(self, rows: list[dict[str, str]]):
        result = bfj.filter_rows(rows, {"countryCode": "NP", "min_individual_count": 0})
        assert [r["gbifID"] for r in result] == ["1", "2", "4"]

    def test_state_province(self, rows: list[dict[str, str]]):
        result = bfj.filter_rows(rows, {"stateProvince": "Bagmati", "min_individual_count": 0})
        assert [r["gbifID"] for r in result] == ["1", "4"]

    def test_locality(self, rows: list[dict[str, str]]):
        result = bfj.filter_rows(rows, {"locality": "Kathmandu", "min_individual_count": 0})
        assert [r["gbifID"] for r in result] == ["1", "4"]

    def test_area_with_area_field(self, rows: list[dict[str, str]]):
        result = bfj.filter_rows(
            rows,
            {"area": "Gandaki", "area_field": "stateProvince", "min_individual_count": 0},
        )
        assert [r["gbifID"] for r in result] == ["2"]

    def test_area_locality_field(self, rows: list[dict[str, str]]):
        result = bfj.filter_rows(
            rows,
            {"area": "Pokhara", "area_field": "locality", "min_individual_count": 0},
        )
        assert [r["gbifID"] for r in result] == ["2"]

    def test_species_partial_match(self, rows: list[dict[str, str]]):
        result = bfj.filter_rows(rows, {"species": "Lophophorus impejanus", "min_individual_count": 0})
        assert [r["gbifID"] for r in result] == ["1", "3"]

    def test_species_matches_scientific_name(self, rows: list[dict[str, str]]):
        result = bfj.filter_rows(rows, {"species": "Milvus migrans (Boddaert", "min_individual_count": 0})
        assert [r["gbifID"] for r in result] == ["4"]

    def test_min_individual_count(self, rows: list[dict[str, str]]):
        result = bfj.filter_rows(rows, {"min_individual_count": 2})
        assert [r["gbifID"] for r in result] == ["1", "4"]

    def test_limit(self, rows: list[dict[str, str]]):
        result = bfj.filter_rows(
            rows,
            {"countryCode": "NP", "min_individual_count": 0, "limit": 2},
        )
        assert len(result) == 2
        assert [r["gbifID"] for r in result] == ["1", "2"]

    def test_combined_filters(self, rows: list[dict[str, str]]):
        result = bfj.filter_rows(
            rows,
            {
                "countryCode": "NP",
                "stateProvince": "Bagmati",
                "species": "Lophophorus",
                "min_individual_count": 1,
            },
        )
        assert [r["gbifID"] for r in result] == ["1"]


class TestParseArgs:
    def test_cli_flags(self):
        config = bfj.parse_args(
            ["--country-code", "NP", "--species", "Corvus", "--limit", "50"]
        )
        assert config["filters"]["countryCode"] == "NP"
        assert config["filters"]["species"] == "Corvus"
        assert config["filters"]["limit"] == 50

    def test_params_file_overrides_defaults(self, tmp_path: Path):
        params = tmp_path / "p.json"
        params.write_text('{"countryCode": "IN", "limit": 1}', encoding="utf-8")
        config = bfj.parse_args(["--params", str(params), "--country-code", "NP"])
        assert config["filters"]["countryCode"] == "NP"
        assert config["filters"]["limit"] == 1


class TestSlimAndDedupe:
    def test_slim_row_omits_empty_and_extra_columns(self, rows: list[dict[str, str]]):
        slim = bfj.slim_row(rows[0])
        assert "gbifID" not in slim
        assert "eventDate" not in slim
        assert slim["species"] == "Lophophorus impejanus"
        assert slim["scientificName"] == "Lophophorus impejanus (Latham, 1790)"
        assert slim["locality"] == "Kathmandu"
        assert slim["year"] == 2024
        assert slim["individualCount"] == 2
        assert slim["coordinates"] == {"lat": 28.1, "lon": 85.5}

    def test_dedupe_same_species_and_locality(self, rows: list[dict[str, str]]):
        duplicate = rows[0].copy()
        assert len(bfj.dedupe_rows(rows[:1] + [duplicate])) == 1


class TestBuildForestJson:
    def test_output_has_rag_fields_only(self, sample_csv: Path, tmp_path: Path):
        out = tmp_path / "out.json"
        result = bfj.build_forest_json(
            {"countryCode": "NP", "limit": 1},
            csv_path=str(sample_csv),
            out_path=str(out),
        )
        assert len(result) == 1
        assert set(result[0].keys()) <= EXPECTED_OUTPUT_KEYS
        assert "year" in result[0]
        assert "coordinates" in result[0]
        assert "gbifID" not in result[0]
        written = json.loads(out.read_text(encoding="utf-8"))
        assert written == result

    def test_writes_json_array(self, sample_csv: Path, tmp_path: Path):
        out = tmp_path / "out.json"
        bfj.build_forest_json(
            {"stateProvince": "Gandaki"},
            csv_path=str(sample_csv),
            out_path=str(out),
        )
        data = json.loads(out.read_text(encoding="utf-8"))
        assert isinstance(data, list)
        assert len(data) == 1
        assert data[0]["species"] == "Corvus splendens"
        assert data[0]["locality"] == "Pokhara"

    def test_dedupes_before_limit(self, sample_csv: Path, tmp_path: Path):
        out = tmp_path / "out.json"
        result = bfj.build_forest_json(
            {"countryCode": "NP"},
            csv_path=str(sample_csv),
            out_path=str(out),
        )
        # 3 unique NP rows (gbif 1, 2, 4) — not 3 copies of overlapping data
        assert len(result) == 3
        localities = [r["locality"] for r in result]
        assert len(localities) == len(set(localities))

    def test_native_country_fallback(self, sample_csv: Path, tmp_path: Path):
        out = tmp_path / "out.json"
        result = bfj.build_forest_json(
            {"countryCode": "NP", "limit": 10},
            csv_path=str(sample_csv),
            out_path=str(out),
            detail=False,
        )
        assert result["native_species_count"] == 3
        assert result["native_percentage"] == 100.0

    def test_native_data_mapping(self, sample_csv: Path, tmp_path: Path):
        out = tmp_path / "out.json"
        native_data = {"NP": ["Corvus splendens"]}
        result = bfj.build_forest_json(
            {"countryCode": "NP", "limit": 10},
            csv_path=str(sample_csv),
            out_path=str(out),
            detail=False,
            native_data=native_data,
        )
        assert result["native_species_count"] == 1
        assert result["native_percentage"] == pytest.approx(33.333, rel=1e-3)
