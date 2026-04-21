# Archive Original Downloader

Public beta browser extension for downloading original archive scans from supported archive websites.

The extension is intended for researchers, genealogists and archivists who need to save scans with meaningful file names. It supports single-image downloads, range downloads and full-document downloads as ZIP archives or separate JPG files.

## Status

This is a beta version. It works with the current layouts of supported websites. If an archive website changes its viewer or page markup, the extension may require an update.

## Supported Browsers

- Google Chrome
- Opera

The extension is installed manually as an unpacked extension.

## Supported Websites

- Yandex Archive: `https://yandex.ru/archive/` and `https://ya.ru/archive/`
- CGAMOS metric books: `https://cgamos.ru/metric-books/`
- CGAMOS old believers metric books: `https://cgamos.ru/metric-books/staroobryadtsy/`
- CGAMOS other confessions: `islam`, `iudaizm`, `catholicism`
- CGAMOS `skazki`
- CGAMOS `ispovedalnye_vedomosti`
- CGAMOS `obyski`
- CGAMOS `cemetery`
- CGAMOS `books-of-moscow-maternity-hospitals`
- CGAMOS `l-dela`
- CGAMOS `posemeynye-spiski`
- CGAMOS `posemeynye-spiski/tsehovyh-i-remeslennikov`
- Moscow Region archive image viewer: `https://arch.mosreg.ru/srv2/private/imageViewer/`

## Important Notes

- For the Moscow Region archive, sign in before downloading: `https://arch.mosreg.ru/login`
- If you do not have an account, register here: `https://arch.mosreg.ru/registration`
- In Opera, for Yandex Archive, enable the extension option named "Allow access to search page results" / "Разрешить доступ к результатам на странице поиска". Without this option, the download panel may not appear on Yandex Archive pages.
- Download only materials that are available to you and follow the terms of use of the relevant archive website.

## Installation

1. Download the ZIP archive from GitHub Releases.
2. Unpack it into a separate folder.
3. Open the browser extensions page.
4. Enable developer mode.
5. Choose "Load unpacked".
6. Select the unpacked extension folder.

Chrome extensions page:

```text
chrome://extensions/
```

Opera extensions page:

```text
opera://extensions/
```

## Usage

1. Open a supported archive page with a scan.
2. Wait until the image is loaded.
3. Click `Скачать скан` to download the current scan.
4. Click `Скачать всё дело` to download a range or the whole document.
5. Choose the range in the `С` and `По` fields if needed.
6. Choose `Одним ZIPом` or `Отдельными файлами JPG`.
7. Confirm the download.

During bulk download, the process can be interrupted. On the Moscow Region archive website, the page may automatically navigate through image numbers; this is expected behavior.

## File Name Examples

- Yandex Archive: `ЦГА_Москвы_[ЯА]_203-780-880-0005.jpg`
- CGAMOS: `ЦГА_Москвы_203-745-630-0001.jpg`
- Moscow Region archive: `ЦГА_МосОбл_2510-1-850-#обл(цв).jpg`

## ZIP Contents

ZIP archives contain JPG scan files and `info.txt`. If some pages fail during bulk download, `errors.txt` is added.

## Russian Documentation

See [README-RU.txt](README-RU.txt).

## License

No license has been selected yet. Before publishing as an open-source project, choose a license that matches how you want others to use, modify and redistribute the extension.

