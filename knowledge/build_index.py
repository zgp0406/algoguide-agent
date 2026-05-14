from __future__ import annotations

import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from knowledge.library import rebuild_artifacts


def main() -> None:
    result = rebuild_artifacts()
    print(
        f"wrote {result['chunk_count']} chunks to index artifacts "
        f"with model {result['model_name']} (faiss={result['faiss_status']})"
    )


if __name__ == "__main__":
    main()
