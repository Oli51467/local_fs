import pytest

from server.api.document_api import (
    CODE_TYPES,
    SUPPORTED_FILE_TYPES,
    extract_text_and_images,
    extract_text_content,
)


def test_code_extensions_supported():
    ace_extensions = {
        'js', 'jsx', 'ts', 'tsx', 'json', 'py', 'java', 'cpp', 'c', 'h', 'hpp',
        'css', 'scss', 'sass', 'less', 'html', 'xml', 'php', 'rb', 'go', 'rs',
        'sh', 'bash', 'sql', 'yaml', 'yml', 'toml', 'ini', 'conf'
    }

    assert CODE_TYPES == ace_extensions
    assert ace_extensions.issubset(SUPPORTED_FILE_TYPES)


@pytest.mark.parametrize("suffix,text", [
    ("py", "print('hello backend')\n"),
    ("js", "console.log('hello backend');\n"),
])
def test_extract_text_for_code_files(tmp_path, suffix, text):
    file_path = tmp_path / f"example.{suffix}"
    file_path.write_text(text, encoding="utf-8")

    extracted = extract_text_content(file_path, suffix)
    assert extracted == text

    extracted_text, images, cleanup = extract_text_and_images(file_path, suffix)
    assert extracted_text == text
    assert images == []
    assert cleanup == []
