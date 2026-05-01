class Dad < Formula
  desc "GitHub PRs as narrated stories — AI-powered semantic diff review"
  homepage "https://github.com/nicknisi/diffdad"
  version "0.5.1"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/nicknisi/diffdad/releases/download/v#{version}/dad-darwin-arm64.tar.gz"
      sha256 "bf1e0b470d3496cccceba546320e670def8c3e06e9042390e1812d4d5f4ec59c"
    else
      url "https://github.com/nicknisi/diffdad/releases/download/v#{version}/dad-darwin-x86_64.tar.gz"
      sha256 "29f51fd1610e333755b3c55a0c0a5c41605306d8c3373f11a42f8600006d41cb"
    end
  end

  on_linux do
    url "https://github.com/nicknisi/diffdad/releases/download/v#{version}/dad-linux-x86_64.tar.gz"
    sha256 "aa9c366a791763b8dfcbe2a6543043780d361d9fe176d19e4d98352e297b9fab"
  end

  def install
    bin.install "dad"
    (share/"diffdad").install "share/diffdad/web"
  end

  test do
    assert_match "dad - GitHub PRs", shell_output("#{bin}/dad --help")
  end
end
