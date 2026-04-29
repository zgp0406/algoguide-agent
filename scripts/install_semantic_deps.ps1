$ErrorActionPreference = "Stop"

$proxyVars = @(
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "GIT_HTTP_PROXY",
  "GIT_HTTPS_PROXY",
  "git_http_proxy",
  "git_https_proxy",
  "PIP_PROXY",
  "PIP_NO_INDEX",
  "PIP_INDEX_URL",
  "PIP_EXTRA_INDEX_URL"
)

foreach ($name in $proxyVars) {
  if (Test-Path "Env:$name") {
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
  }
}

$env:PIP_INDEX_URL = "https://pypi.tuna.tsinghua.edu.cn/simple"
$env:PIP_TRUSTED_HOST = "pypi.tuna.tsinghua.edu.cn"
$env:NO_PROXY = "*"
$env:no_proxy = "*"

python -m pip install "sentence-transformers>=3.0,<4.0" "faiss-cpu>=1.8,<2.0"
