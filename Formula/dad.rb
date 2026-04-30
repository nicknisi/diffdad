class Dad < Formula
  desc "GitHub PRs as narrated stories — AI-powered semantic diff review"
  homepage "https://github.com/nicknisi/diffdad"
  version "0.0.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/nicknisi/diffdad/releases/download/v#{version}/dad-darwin-arm64.tar.gz"
      sha256 "PLACEHOLDER"
    else
      url "https://github.com/nicknisi/diffdad/releases/download/v#{version}/dad-darwin-x86_64.tar.gz"
      sha256 "PLACEHOLDER"
    end
  end

  on_linux do
    url "https://github.com/nicknisi/diffdad/releases/download/v#{version}/dad-linux-x86_64.tar.gz"
    sha256 "PLACEHOLDER"
  end

  def install
    bin.install "dad"
    (share/"diffdad").install "share/diffdad/web"
  end

  test do
    assert_match "dad - GitHub PRs", shell_output("#{bin}/dad --help")
  end
end
