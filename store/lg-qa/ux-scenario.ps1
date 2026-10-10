<#
Builds the UX scenario document LG Seller Lounge asks for, from LG's own template
(ux_scenario_document_*.ppt in "documents for app QA"), with the screenshots in store/.
Needs Windows with Microsoft PowerPoint.

  pwsh store/lg-qa/ux-scenario.ps1 -PlaylistUrl https://example.com/zaplist.m3u [-Email support@example.com]

Writes store/lg-qa/Zaplist_UX_Scenario_<version>.pptx. -PreviewDir also exports every slide as PNG.
#>
param(
  [string]$Email = 'nomoredazzling@gmail.com',
  [string]$PlaylistUrl = 'https://raw.githubusercontent.com/dazzling-no-more/zaplist/main/store/test-playlist.m3u',
  [datetime]$Date = (Get-Date),
  [string]$Template,
  [string]$PreviewDir
)
$ErrorActionPreference = 'Stop'

$root = Split-Path (Split-Path $PSScriptRoot)
$version = (Get-Content (Join-Path $root 'appinfo.json') -Raw | ConvertFrom-Json).version
$out = Join-Path $PSScriptRoot "Zaplist_UX_Scenario_$version.pptx"
$shots = Join-Path $root 'store\screenshots'
$images = Join-Path $PSScriptRoot 'images'

if (-not $Template) {
  $tmp = Join-Path ([IO.Path]::GetTempPath()) "zaplist-lg-qa-$PID"
  New-Item -ItemType Directory -Force $tmp | Out-Null
  $zip = Join-Path $tmp 'documents_for_app_qa.zip'
  Invoke-WebRequest 'https://webostv.developer.lge.com/assets/checklist/documents_for_app_qa.zip' -OutFile $zip
  Expand-Archive $zip -DestinationPath $tmp -Force
  $Template = (Get-ChildItem $tmp -Filter 'ux_scenario_document_*.ppt*' | Select-Object -First 1).FullName
}

function Rgb([int]$r, [int]$g, [int]$b) { $r + 256 * $g + 65536 * $b }
$RED = Rgb 230 0 18
$DARK = Rgb 64 64 64
$LIGHT = Rgb 217 217 217
$WHITE = Rgb 255 255 255
$BORDER = Rgb 166 166 166
# Where screenshots go on a slide (16:9, left of the description table), in points.
$PIC = @{ L = 15; T = 72; W = 550; H = 309.375 }

# --- helpers ----------------------------------------------------------------------------------

function Set-English($shape) { $shape.TextFrame2.TextRange.LanguageID = 1033 }

# The template's Korean text styles let PowerPoint break English words anywhere (latinLnBrk="1"),
# and COM has no switch for it, so the saved slides are patched to break at word boundaries.
function Repair-LineBreaks([string]$path) {
  Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::Open($path, 'Update')
  try {
    foreach ($entry in @($zip.Entries | Where-Object { $_.FullName -like 'ppt/slides/slide*.xml' })) {
      $reader = New-Object IO.StreamReader($entry.Open())
      $xml = $reader.ReadToEnd(); $reader.Close()
      $fixed = $xml -replace '<a:pPr(?![^>]*latinLnBrk)', '<a:pPr latinLnBrk="0"' -replace 'latinLnBrk="1"', 'latinLnBrk="0"' -replace '<a:p>(?!<a:pPr)', '<a:p><a:pPr latinLnBrk="0"/>'
      if ($fixed -eq $xml) { continue }
      $name = $entry.FullName
      $entry.Delete()
      $writer = New-Object IO.StreamWriter($zip.CreateEntry($name).Open(), (New-Object Text.UTF8Encoding($false)))
      $writer.Write($fixed); $writer.Close()
    }
  } finally { $zip.Dispose() }
}

function Get-Details($slide) {
  foreach ($sh in $slide.Shapes) { if ($sh.Type -eq 1 -and $sh.Width -gt 700 -and $sh.Top -gt 370) { return $sh } }
}

# Keeps the slide title, the subtitle and the grey "Detailed Information" box; removes LG's samples.
function Clear-Samples($slide) {
  $remove = @()
  foreach ($sh in $slide.Shapes) {
    $keep = $sh.Top -lt 20 -or ($sh.Name -eq 'TextBox 5' -and $sh.Top -lt 60) -or ($sh.Type -eq 1 -and $sh.Width -gt 700 -and $sh.Top -gt 370)
    if (-not $keep) { $remove += $sh }
  }
  foreach ($sh in $remove) { $sh.Delete() }
}

function Set-Title($slide, [string]$text) {
  foreach ($sh in $slide.Shapes) { if ($sh.Top -lt 20 -and $sh.HasTextFrame) { $sh.TextFrame.TextRange.Text = $text; return } }
}

function Set-Subtitle($slide, [string]$text) {
  $sub = $null
  foreach ($sh in $slide.Shapes) { if ($sh.Name -eq 'TextBox 5' -and $sh.Top -lt 60) { $sub = $sh } }
  if (-not $sub) {
    $sub = $slide.Shapes.AddTextbox(1, 13, 50, 540, 24)
    $sub.Name = 'TextBox 5'
    $font = $sub.TextFrame.TextRange.Font
    $font.Name = $script:subFont.Name; $font.Size = $script:subFont.Size; $font.Bold = $script:subFont.Bold
  }
  $sub.TextFrame.TextRange.Text = $text
  $sub.Width = 540
  Set-English $sub
}

function Set-Details($slide, [string[]]$lines) {
  $box = Get-Details $slide
  $box.Top = 388; $box.Height = 112
  $range = $box.TextFrame.TextRange
  $range.Text = (@('Detailed Information') + ($lines | ForEach-Object { "- $_" })) -join "`r"
  $range.Font.Size = 9; $range.Font.Bold = 0
  $range.Paragraphs(1).Font.Size = 10; $range.Paragraphs(1).Font.Bold = -1
  Set-English $box
}

# A screenshot with red numbered boxes; callouts are @(x, y, w, h) in the 1280x720 image.
function Add-Screen($slide, [string]$image, $callouts) {
  $shot = $slide.Shapes.AddPicture($image, 0, -1, $PIC.L, $PIC.T, $PIC.W, $PIC.H)
  $shot.Line.Visible = -1; $shot.Line.ForeColor.RGB = $BORDER; $shot.Line.Weight = 0.75
  $sx = $PIC.W / 1280; $sy = $PIC.H / 720; $n = 0
  foreach ($c in $callouts) {
    $n++
    $x = $PIC.L + $c[0] * $sx; $y = $PIC.T + $c[1] * $sy
    $box = $slide.Shapes.AddShape(1, $x, $y, $c[2] * $sx, $c[3] * $sy)
    $box.Fill.Visible = 0; $box.Line.ForeColor.RGB = $RED; $box.Line.Weight = 1.5
    $d = 13
    # Just outside the box's top-left corner, so it doesn't cover what the box points at.
    $dot = $slide.Shapes.AddShape(9, [math]::Max(1, $x - $d + 2), [math]::Max($PIC.T - 6, $y - $d + 3), $d, $d)
    $dot.Fill.ForeColor.RGB = $RED; $dot.Line.ForeColor.RGB = $WHITE; $dot.Line.Weight = 0.75
    $tf = $dot.TextFrame
    $tf.MarginLeft = 0; $tf.MarginRight = 0; $tf.MarginTop = 0; $tf.MarginBottom = 0; $tf.WordWrap = 0; $tf.VerticalAnchor = 3
    $tr = $tf.TextRange
    $tr.Text = "$n"; $tr.Font.Name = 'Arial'; $tr.Font.Size = 7; $tr.Font.Bold = -1; $tr.Font.Color.RGB = $WHITE
    $tr.ParagraphFormat.Alignment = 2
  }
}

# Rows: @{ k = 'head' | 'section' | 'item'; c = @(cell texts) }. Sections span the whole width.
function Add-Table($slide, [double]$left, [double]$top, [double[]]$widths, $rows, [double]$size = 8) {
  $total = ($widths | Measure-Object -Sum).Sum
  $shape = $slide.Shapes.AddTable($rows.Count, $widths.Count, $left, $top, $total, $rows.Count * 12)
  $t = $shape.Table
  $t.ApplyStyle('{5940675A-B579-460E-94D1-54222C63F5DA}', $false)  # "No Style, Table Grid"
  for ($c = 1; $c -le $widths.Count; $c++) { $t.Columns.Item($c).Width = $widths[$c - 1] }
  for ($r = 1; $r -le $rows.Count; $r++) {
    $row = $rows[$r - 1]
    $span = $row.k -ne 'item' -and $row.c.Count -eq 1
    if ($span -and $widths.Count -gt 1) { $t.Cell($r, 1).Merge($t.Cell($r, $widths.Count)) }
    for ($c = 1; $c -le $widths.Count; $c++) {
      $cell = $t.Cell($r, $c)
      $text = if ($span) { if ($c -eq 1) { $row.c[0] } else { $null } } else { $row.c[$c - 1] }
      $fill = switch ($row.k) { 'head' { $DARK } 'section' { $LIGHT } default { $WHITE } }
      $cell.Shape.Fill.Visible = -1; $cell.Shape.Fill.Solid(); $cell.Shape.Fill.ForeColor.RGB = $fill
      foreach ($b in 1..4) { $line = $cell.Borders.Item($b); $line.Visible = -1; $line.ForeColor.RGB = $BORDER; $line.Weight = 0.5 }
      $tf = $cell.Shape.TextFrame
      $tf.MarginLeft = 3; $tf.MarginRight = 3; $tf.MarginTop = 2; $tf.MarginBottom = 2; $tf.VerticalAnchor = 3
      if ($null -ne $text) {
        $tr = $tf.TextRange
        $tr.Text = $text
        $tr.Font.Name = 'Arial'; $tr.Font.Size = $size; $tr.Font.Italic = 0
        $tr.Font.Bold = [int]($row.k -ne 'item') * -1
        $tr.Font.Color.RGB = if ($row.k -eq 'head') { $WHITE } else { 0 }
        $center = $row.k -ne 'item' -or ($c -eq 1 -and $widths.Count -eq 2 -and $widths[0] -lt 40)
        $tr.ParagraphFormat.Alignment = if ($center) { 2 } else { 1 }
        Set-English $cell.Shape
      }
    }
    $t.Rows.Item($r).Height = 10
  }
  if ($shape.Top + $shape.Height -gt 386) { Write-Warning "Table on slide $($slide.SlideIndex) reaches $([math]::Round($shape.Top + $shape.Height)) pt" }
  $shape
}

function Item([string]$n, [string]$text) { @{ k = 'item'; c = @($n, $text) } }
function Section([string]$text) { @{ k = 'section'; c = @($text) } }
$HEAD = @{ k = 'head'; c = @('Description') }

# A screen slide: screenshot with callouts, a numbered description per callout, details below.
function Write-Screen($slide, [string]$title, [string]$subtitle, [string]$image, $callouts, [string[]]$descriptions, [string[]]$details, $extraRows = @()) {
  Clear-Samples $slide
  Set-Title $slide $title
  Set-Subtitle $slide $subtitle
  Add-Screen $slide $image $callouts
  $rows = @($HEAD)
  for ($i = 0; $i -lt $descriptions.Count; $i++) { $rows += Item "$($i + 1)" $descriptions[$i] }
  $rows += $extraRows
  [void](Add-Table $slide 570 51 @(22, 184) $rows)
  Set-Details $slide $details
}

function Write-NotApplicable($slide, [string]$title, [string]$subtitle, [string]$message, [string[]]$details) {
  Clear-Samples $slide
  Set-Title $slide $title
  Set-Subtitle $slide $subtitle
  $box = $slide.Shapes.AddTextbox(1, 40, 150, 700, 150)
  $range = $box.TextFrame.TextRange
  $range.Text = "Not applicable`r$message"
  $range.Font.Name = 'Arial'; $range.Font.Size = 16; $range.Font.Bold = 0
  $range.Paragraphs(1).Font.Size = 28; $range.Paragraphs(1).Font.Bold = -1
  Set-English $box
  Set-Details $slide $details
}

# --- build ------------------------------------------------------------------------------------

$app = New-Object -ComObject PowerPoint.Application
$app.AutomationSecurity = 3  # never run macros from the template
try {
  $pres = $app.Presentations.Open($Template, $true, $false, $false)
  foreach ($sh in $pres.Slides.Item(7).Shapes) {
    if ($sh.Name -eq 'TextBox 5') { $f = $sh.TextFrame.TextRange.Font; $script:subFont = @{ Name = $f.Name; Size = $f.Size; Bold = $f.Bold } }
  }

  # Structure first. Template: 1 cover, 2 contents, 3 basic info, 4 history, 5 guideline, 6 login,
  # 7 start page, 8 main page, 9 flow chart, 10 sub menu, 11 sub page, 12 paid, 13 banner ad,
  # 14 video ad, 15 appendix. The optional flow chart and the second ad example go; the sub-page
  # slide is repeated once per screen.
  foreach ($i in 14, 11, 9) { $pres.Slides.Item($i).Delete() }
  $subPages = 11
  for ($i = 1; $i -lt $subPages; $i++) { [void]$pres.Slides.Item(9).Duplicate() }
  $s = { param($n) $pres.Slides.Item($n) }

  # 1. Cover
  $cover = & $s 1
  foreach ($sh in $cover.Shapes) {
    if ($sh.HasTextFrame -and $sh.TextFrame.TextRange.Text -like '*App Title*') { $sh.TextFrame.TextRange.Text = 'Zaplist' }
    if ($sh.HasTable) {
      $sh.Table.Cell(1, 2).Shape.TextFrame.TextRange.Text = '{0:yyyy} / {0:MM} / {0:dd}' -f $Date
      $sh.Table.Cell(2, 2).Shape.TextFrame.TextRange.Text = $version
      $sh.Table.Cell(3, 2).Shape.TextFrame.TextRange.Text = "Name: Zaplist`rE-mail address: $Email"
      foreach ($r in 1..3) { $sh.Table.Cell($r, 2).Shape.TextFrame.TextRange.Font.Italic = 0 }
    }
  }

  # 2. Contents
  foreach ($sh in (& $s 2).Shapes) {
    if ($sh.HasTextFrame -and $sh.TextFrame.TextRange.Text -like '1. Basic*') {
      $sh.TextFrame.TextRange.Text = @(
        '1. Basic Information', '2. Document History', '3. Remote Control Keys', '4. Detailed Login Information',
        '5. Main Page Description', '6. Sub Page Description', '7. Paid Content (not applicable)', '8. In-App Ad (not applicable)'
      ) -join "`r"
    }
  }

  # 3. Basic information
  foreach ($sh in (& $s 3).Shapes) {
    if (-not $sh.HasTable) { continue }
    $values = @(
      'Zaplist', 'Entertainment', 'Web (packaged IPK)', '1920*1080', 'Global', 'English', 'No',
      'webOS (webOS TV 4.0 and later)', 'Not Applicable', 'Not Applicable', 'Not applicable (not a game; no BGM or sound effects)',
      'Not applicable (packaged app)', 'Not applicable (the IPK is attached)', 'webOS'
    )
    for ($i = 0; $i -lt $values.Count; $i++) {
      $tr = $sh.Table.Cell($i + 2, 3).Shape.TextFrame.TextRange
      $tr.Text = $values[$i]; $tr.Font.Size = 9
      Set-English $sh.Table.Cell($i + 2, 3).Shape
    }
  }

  # 4. Document history
  foreach ($sh in (& $s 4).Shapes) {
    if (-not $sh.HasTable) { continue }
    $cells = @('1', $Date.ToString('dd.MM.yyyy'), $version, "Zaplist_UX_Scenario_$version", 'Initial document')
    for ($c = 0; $c -lt 5; $c++) { $sh.Table.Cell(2, $c + 1).Shape.TextFrame.TextRange.Text = $cells[$c] }
  }

  # 5. Remote control keys (LG's guideline slide)
  $keys = & $s 5
  Clear-Samples $keys
  Set-Title $keys '3. Remote Control Keys'
  Set-Subtitle $keys '1. Keys used in the app'
  $rows = @(
    @{ k = 'head'; c = @('Key', 'What it does') },
    (Item 'Arrow keys' 'Move the focus. In the player: Up/Down change the channel, Left/Right show the info bar.'),
    (Item 'OK' 'Select, or play the focused channel. In the player: open the channel list.'),
    (Item 'OK (hold)' 'Channel menu: add to or remove from Favorites; in Favorites also move the channel.'),
    (Item 'Back' 'Close the open bar, menu or list, or go back one screen. On Home: leave the app through the system (exit popup or Home screen).'),
    (Item 'CH + / CH -' 'Page up/down in lists. In the player: next/previous channel.'),
    (Item '0-9' 'In the player: go to a channel number.'),
    (Item 'Red' 'Add or remove the focused or playing channel from Favorites.'),
    (Item 'Yellow' 'In the player: change the picture mode. In Favorites: move the channel.'),
    (Item 'Info' 'In the player: show or hide the info bar.'),
    (Item 'Play / Pause / Stop' 'In the player: resume, pause, or return to the previous screen.'),
    (Item 'Magic Remote' 'Point and click any item; the wheel scrolls lists and the TV guide.')
  )
  [void](Add-Table $keys 27 80 @(130, 596) $rows 9)
  Set-Details $keys @(
    'Everything also works with the arrows and OK alone: the Magic Remote has no color or media keys, so each color-key and media-key action also has an on-screen button.',
    'Home, Exit, volume and input keys are handled by the TV.'
  )

  # 6. Login information: the app has no accounts; testers add a playlist.
  $login = & $s 6
  Write-Screen $login '4. Detailed Login Information' '1. Adding a playlist (the app has no user accounts)' (Join-Path $shots '6-add-source.png') `
    @(@(397, 35, 326, 54), @(400, 100, 668, 80), @(400, 188, 668, 80), @(400, 276, 668, 80), @(400, 365, 182, 52)) `
    @('Source type: M3U playlist or Xtream Codes login', 'Name shown in the source list', 'Playlist URL (M3U/M3U8)', 'TV guide (XMLTV) URL, optional', 'Check and save: downloads the playlist and saves it') `
    @(
      'Zaplist has no sign-in, account or activation, and it includes no channels: users add a playlist from their TV provider.',
      'To test: on the start page press OK on "Add a playlist", enter any name and the test playlist URL from the table, then press "Check and save". Home opens with 5 channels in 2 categories; the TV guide fills in moments later.',
      'The Xtream Codes tab asks for a server address, username and password, and checks the login before saving.'
    ) `
    @((Section 'Test playlist (no account needed)'), (Item '1' $PlaylistUrl), (Section 'Xtream Codes test account'), (Item '-' 'Needs an account from an IPTV provider; not supplied. The M3U path covers the same screens.'), (Section 'Activation codes'), (Item '-' 'Not applicable'))

  # 7-8. Main pages
  Write-Screen (& $s 7) '5. Main Page Description' '1. Start page (first launch)' (Join-Path $images 'welcome.png') `
    @(@(580, 163, 120, 155), @(345, 383, 590, 50), @(556, 457, 168, 58)) `
    @('App icon and title', 'Notice: the app includes no channels', 'Add a playlist: opens the playlist form (see 4)') `
    @(
      'Shown while no playlist has been added. After the playlist is saved, Home opens.',
      'Back leaves the app through the system (exit popup or Home screen, depending on the webOS version).'
    )

  Write-Screen (& $s 8) '5. Main Page Description' '2. Home' (Join-Path $shots '1-home.png') `
    @(@(80, 106, 280, 36), @(80, 154, 280, 36), @(80, 202, 280, 36), @(80, 262, 262, 112), @(80, 380, 262, 280), @(404, 133, 808, 48), @(1158, 134, 44, 44), @(1090, 40, 120, 30), @(398, 655, 360, 30)) `
    @('Search: find channels by name', 'TV guide: programme grid', 'Settings', 'Favorites, Recent and All channels, with channel counts', 'Playlist categories; the list on the right follows the focus', 'Channel: number, logo, name and programme on now. OK plays it', 'Favorite star: Right, then OK (or click)', 'Number of channels in the category', 'Key hints') `
    @(
      'Up/Down move through the sidebar or the channel list; Right/Left move between them; CH +/- page through the list.',
      'Hold OK on a channel for its menu (see 6-5). The red key adds or removes a favorite.',
      'Back on Home leaves the app through the system.'
    )

  # 9-19. Sub pages
  $sub = '6. Sub Page Description'
  Write-Screen (& $s 9) $sub '1. Player' (Join-Path $shots '2-player.png') `
    @(@(110, 505, 460, 95), @(975, 532, 230, 44), @(84, 612, 130, 56), @(216, 612, 184, 56), @(404, 612, 274, 56), @(684, 612, 124, 56), @(814, 612, 152, 56), @(970, 612, 168, 56)) `
    @('Channel number, logo, name, programme now and next', 'Programme progress and clock', 'Play / Pause', 'Channel list (see 6-2)', 'Add to / remove from Favorites', 'Audio track', 'Subtitles', 'Picture mode: Fit, Zoom, Fill, 16:9, 4:3') `
    @(
      'The info bar shows when the channel changes and hides after 5 seconds; Left/Right or Info show it with its buttons.',
      'Up/Down or CH +/- change the channel; number keys go to a channel; OK opens the channel list.',
      'Back hides the bar, then returns to Home. If the network drops, a message shows and playback resumes by itself.'
    )

  Write-Screen (& $s 10) $sub '2. Channel list (OK in the player)' (Join-Path $shots '3-channel-list.png') `
    @(@(75, 48, 145, 34), @(224, 48, 147, 34), @(78, 88, 290, 485), @(398, 46, 582, 34), @(393, 86, 592, 590), @(928, 140, 44, 40)) `
    @('Search', 'TV guide', 'Categories with channel counts', 'Category and position in the list', 'Channels; the blue mark shows the channel playing now', 'Favorite star: Right, then OK') `
    @(
      'Opens over the video on the current channel. Left/Right move between categories and channels.',
      'OK on a channel switches to it and closes the list. Back closes the list.'
    )

  Write-Screen (& $s 11) $sub '3. TV guide' (Join-Path $shots '4-guide.png') `
    @(@(60, 35, 520, 95), @(300, 150, 915, 28), @(60, 190, 240, 440), @(300, 182, 915, 448), @(403, 238, 306, 56), @(60, 636, 490, 26)) `
    @('Focused programme: channel, time, title, description', 'Date and time scale', 'Channels', 'Programmes; the red line marks the current time', 'Focused programme', 'Key hints') `
    @(
      'Arrow keys move through programmes and channels; CH +/- page; the wheel scrolls. OK on a programme on air plays its channel.',
      'Guide data comes from XMLTV named in the playlist, in Settings, or by the Xtream server.',
      'The test playlist comes with guide data, so every test channel shows programmes.'
    )

  Write-Screen (& $s 12) $sub '4. Search' (Join-Path $shots '5-search.png') `
    @(@(400, 36, 816, 80), @(394, 121, 100, 28), @(404, 168, 808, 330), @(1158, 176, 44, 40)) `
    @('Search field: OK opens the LG keyboard', 'Number of results', 'Results update while typing. OK plays the channel', 'Favorite star: Right, then OK') `
    @(
      'Search ignores case and accents and matches any part of a channel name.',
      'Down moves from the field to the results. Back closes the keyboard, then the screen.'
    )

  Write-Screen (& $s 13) $sub '5. Channel menu (hold OK on a channel)' (Join-Path $images 'home-menu.png') `
    @(@(355, 278, 570, 165), @(382, 358, 258, 54), @(642, 358, 252, 54)) `
    @('Channel menu', 'Add to / remove from Favorites', 'Cancel') `
    @(
      'In Favorites the menu also offers Move: Up/Down reorder the channel and OK finishes.',
      'Back closes the menu.'
    )

  Write-Screen (& $s 14) $sub '6. Settings: Sources' (Join-Path $images 'settings-sources.png') `
    @(@(58, 100, 306, 232), @(400, 86, 816, 74), @(912, 96, 108, 52), @(1028, 96, 72, 52), @(1108, 96, 96, 52), @(400, 172, 156, 52)) `
    @('Settings sections', 'Playlist: type, channels, last update', 'Refresh: download the playlist again', 'Edit the playlist', 'Delete (asks for confirmation)', 'Add another playlist (see 4)') `
    @('Xtream Codes sources also show the account''s expiry date and connection limit.')

  Write-Screen (& $s 15) $sub '7. Settings: TV guide' (Join-Path $images 'settings-guide.png') `
    @(@(398, 85, 470, 98), @(400, 205, 668, 118), @(400, 336, 336, 92), @(400, 448, 358, 92)) `
    @('Guide status and Refresh guide now', 'Extra XMLTV guide address for all sources (optional)', 'Time offset for guide times', 'Automatic refresh interval') `
    @('The guide also refreshes by itself at the chosen interval.')

  Write-Screen (& $s 16) $sub '8. Settings: Parental control' (Join-Path $images 'settings-parental.png') `
    @(@(400, 86, 264, 52), @(400, 160, 392, 30), @(404, 246, 808, 42)) `
    @('Change PIN / Turn off', 'Locked categories: OK locks or unlocks', 'A locked category') `
    @(
      'Setting a 4-digit PIN turns parental control on. The PIN is asked for before these settings can be changed.',
      'This is how users protect adult content in their own playlists; the app has no content of its own.'
    )

  Write-Screen (& $s 17) $sub '9. Locked category' (Join-Path $images 'home-locked.png') `
    @(@(80, 420, 262, 36), @(398, 92, 210, 102)) `
    @('Locked category: lock icon, no count', 'Unlock: asks for the PIN (see 6-10)') `
    @(
      'Channels of locked categories are hidden everywhere (All channels, Favorites, Recent, Search) until the PIN is entered.',
      'They lock again when the app restarts.'
    )

  Write-Screen (& $s 18) $sub '10. PIN entry' (Join-Path $images 'pin-dialog.png') `
    @(@(565, 216, 150, 30), @(455, 255, 370, 232), @(452, 498, 376, 56)) `
    @('Digits entered', 'Keypad; the number keys on the remote also work', 'Cancel') `
    @('A wrong PIN shows "Wrong PIN. Try again." Back cancels.')

  Write-Screen (& $s 19) $sub '11. Settings: About' (Join-Path $images 'settings-about.png') `
    @(@(398, 92, 300, 22), @(398, 122, 300, 54), @(398, 184, 420, 116), @(398, 310, 520, 24), @(400, 432, 146, 54), @(398, 512, 700, 24)) `
    @('App name and version', 'TV model and webOS version', 'Playback diagnostics', 'Stored data', 'Clear cache: downloads channel lists and guide again', 'License and content notice') `
    @('Clear cache keeps playlists, favorites and settings.')

  # 20-21. Paid content and ads
  Write-NotApplicable (& $s 20) '7. Paid Content' '1. Payment methods' 'Zaplist is free. There are no purchases, subscriptions or payments of any kind, inside or outside the app.' `
    @('No test credit cards or voucher codes are needed.')
  Write-NotApplicable (& $s 21) '8. In-App Ad' '1. Ad information' 'Zaplist shows no advertising of any kind.' @('No ad network or ad content is included.')

  # 22. Appendix
  foreach ($sh in (& $s 22).Shapes) {
    if ($sh.HasTextFrame -and $sh.TextFrame.TextRange.Text -like 'If you have anything*') {
      $sh.Height = 400
      $sh.TextFrame.TextRange.Text = @(
        'If you have anything to let the LG QA Management know, please comment here. Any detailed references will be welcome.',
        '',
        '1. Zaplist includes no channels. Add the test playlist from 4 to test playback and the TV guide; it uses public test streams (Blender Foundation open movies, Apple and Google test streams) and comes with guide data.',
        '2. Xtream Codes sources need an account from an IPTV provider, which we can''t supply; the M3U path covers the same screens.',
        '3. Back on the first screen calls webOS.platformBack(), so the TV shows its exit popup or Home screen depending on the webOS version.',
        '4. No credentials are hard-coded. The words "password", "credential" and "token" in the package come from the Xtream Codes API parameters, the login form field, the core-js URL polyfill (URL.password) and the XHR/fetch withCredentials options in hls.js and mpegts.js. Playlist URLs, logins, the cached channel lists and guide addresses, and the parental PIN are stored only on the TV, encrypted (AES-GCM, key generated on the TV).',
        "5. Contact: $Email"
      ) -join "`r"
      $sh.TextFrame.TextRange.Font.Size = 12
      Set-English $sh
    }
  }

  if (Test-Path $out) { Remove-Item $out }
  $pres.SaveAs($out, 24)
  $pres.Close()
  Repair-LineBreaks $out
  if ($PreviewDir) {
    New-Item -ItemType Directory -Force $PreviewDir | Out-Null
    $saved = $app.Presentations.Open($out, $true, $false, $false)
    foreach ($slide in $saved.Slides) { $slide.Export((Join-Path $PreviewDir "slide$($slide.SlideIndex).png"), 'PNG', 1560, 1080) }
    $saved.Close()
  }
  Write-Output "Wrote $out ($($subPages + 11) slides)"
} finally {
  $app.Quit()
}
