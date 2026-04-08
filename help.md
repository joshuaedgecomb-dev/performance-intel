# ULTRA Development Guide

Reference for building pages and endpoints in the ULTRA call center QA platform.

## Tech Stack

- **Backend**: PHP 8.x, Microsoft SQL Server (`sqlsrv` driver)
- **Frontend**: Bootstrap 5, jQuery 3.7, Underscore.js, custom BaseJS framework
- **Auth**: JWT RS256 via `base.php` (lcobucci/jwt)


---

## PHP / SQL Library (`sqllib.php`)

### Authentication — Always Start Here

Every PHP page and JSON endpoint **must** include `base.php`. This validates the JWT token and sets up the `$SQL` database connection.

```php
<?php require_once $_SERVER['DOCUMENT_ROOT'] . "/base.php"; ?>
```

**Never** include `SQL.php` directly — it bypasses authentication.

### `param($name, $default = NULL)`

Reads a value from `$_REQUEST` (GET, POST, or COOKIE). Returns `$default` if the parameter is missing or an empty string.

```php
$id    = param("id");              // returns NULL if missing
$page  = param("page", 1);        // returns 1 if missing
$filter = param("Filter_Job", "[]"); // returns "[]" if missing (useful for multi-select)
```

### Query Functions

All query functions accept `($conn, $sql, $params, $options)`. Use `?` placeholders for parameters — never concatenate user input.

| Function | Returns | Notes |
|---|---|---|
| `sqlsrv_json($SQL, $query, $params)` | JSON array string `[{...}, {...}]` | Uses `JSON_NUMERIC_CHECK` — numeric strings become numbers |
| `sqlsrv_jsonrow($SQL, $query, $params)` | JSON object string `{...}` | First row only, also uses `JSON_NUMERIC_CHECK` |
| `sqlsrv_array($SQL, $query, $params)` | PHP array | For server-side processing |

**Parameter auto-wrap**: A single value is automatically wrapped in an array, so `param("id")` and `array(param("id"))` both work for a single-param query.

**Multiple parameters** must be wrapped in `array()`:

```php
sqlsrv_json($SQL, "SELECT ... WHERE a = ? AND b = ?", array(param("a"), param("b")));
```

**Query timeout** for long-running queries:

```php
ini_set("max_execution_time", 241);
sqlsrv_json($SQL, "...", array(...), array("QueryTimeout" => 240));
```

### Optional Filters (Critical Pattern)

**Never build SQL dynamically in PHP.** Use SQL variables and null-check patterns instead.

**Single optional filter:**

```php
<?php require_once $_SERVER['DOCUMENT_ROOT'] . "/base.php"; ?>
<?= sqlsrv_json($SQL, "
    declare @ft varchar(100) = ?

    SELECT Name, Score
    FROM ultra.dbo.Agent
    WHERE (@ft is null or Department = @ft)
", param("ft", null)); ?>
```

**Multi-select array filter** (frontend sends `JSON.stringify(array)`, backend uses OPENJSON):

```php
<?php require_once $_SERVER['DOCUMENT_ROOT'] . "/base.php"; ?>
<?= sqlsrv_json($SQL, "
    declare @start as date = ?
    declare @end as date = ?
    declare @agentlist varchar(max) = ?

    SELECT Agent_Name, Score
    FROM ultra.dbo.Score
    LEFT JOIN ultra.dbo.Agent ON Score_Agent = Agent_FK
    WHERE cast(Score_Date as date) between @start and @end
    AND (@agentlist = '[]' or Score_Agent in (select value from openjson(@agentlist)))
", array(
    param("Search_Start"),
    param("Search_End"),
    param("Search_AgentList", "[]")
)); ?>
```

### Minimal JSON Endpoint Example

A complete endpoint file — one file, one query:

```php
<?php require_once $_SERVER['DOCUMENT_ROOT'] . "/base.php"; ?>
<?= sqlsrv_json($SQL, "
    SELECT Agent_FK as ID, Agent_Name as Name
    FROM ultra.dbo.Agent
    ORDER BY Agent_Name
"); ?>
```

---

## BaseJS Frontend Framework

BaseJS loads all dependencies (jQuery, Bootstrap, DataTables, CanvasJS, Underscore, etc.) from CDNs with automatic local fallback. Everything attaches to the global `gcs` namespace.

### Page Initialization

Every page must wait for libraries to load, then set up the AJAX error handler:

```javascript
gcs.basejsDone.then(() => {
    gcs.ajaxerror();
    // page code here
});
```

`gcs.ajaxerror()` redirects to the login page on 401/403 responses.

### Pages in the iframe

Pages displayed inside the `index.php` iframe that use a sidebar must include this in the `<body>`:

```html
<span id="bar" class="hidden"></span>
```

---

## `gcs.bsdt()` — Data Tables

Creates an interactive table from a JSON endpoint. Returns an options object with `reload()`, `DataTable` (API), and `dataTable` (jQuery element).

### Core Options

| Option | Type | Default | Description |
|---|---|---|---|
| `url` | string | **required** | JSON endpoint returning `[{...}, {...}]` |
| `urlData` | object | `{}` | Key-value pairs sent as GET params to the URL |
| `parent` | string | `'body'` | CSS selector for the container element (alias: `target`) |
| `id` | string | `'dataTable'` | The `id` attribute for the `<table>` element |
| `example` | object | first row | Defines columns and their types: `{ID:'', Name:'', Score:0}` |
| `column` | array | from example | Array of JSON keys in display order: `['ID', 'Name', 'Score']` |
| `header` | array | from example | Display names for columns: `['ID', 'Agent Name', 'Score']` |
| `render` | string/array | `[]` | DataTables render helpers: `'text()'` or `['text()', 'number(null,null,2,"$")']` |
| `columns` | array | built from above | Full DataTables column config objects (advanced override) |
| `paging` | boolean | `false` | Show pagination instead of vertical scroll |
| `search` | boolean | `true` | Show the search box |
| `order` | array | `[]` | Initial sort: `[{name:'Name', dir:'asc'}]` |
| `filename` | string | page title | Download filename for exports (alias: `title`) |
| `loader` | string | `'cog'` | Loading animation style: `'cog'`, `'circle'`, or `'wave'` |
| `map` | function | identity | Transform raw JSON data before display |
| `done` | function | noop | Callback after table is created |
| `draw` | function | noop | Callback on every table redraw (sort, filter, page) |

### Column Mapping (Important!)

`column` maps **positionally** to the data. You must include ALL keys from your data, including hidden ones like `ID`. Headers named `"ID"` or `undefined` are automatically hidden. Omitting a key shifts every column off by one.

```javascript
// Data: [{ID: 1, Name: "John", Score: 95}, ...]
gcs.bsdt({
    url: '/JSON/get/agents.php',
    example: {ID: '', Name: '', Score: 0},
    column: ['ID', 'Name', 'Score'],    // ID must be here even though it's hidden
    header: ['ID', 'Agent Name', 'Score'], // 'ID' header auto-hides the column
});
```

### Row Action Buttons

| Option | Type | Description |
|---|---|---|
| `edit` | function(row) | Shows an edit button (pencil icon) on each row |
| `del` | function(row) | Shows a delete button (trash icon) on each row |
| `add` | function(e, dt, node, config) | Shows an "Add" button in the toolbar |
| `info` | function(row) | Shows an info button on each row |
| `buttons` | array | Custom buttons: `[{name, callback, icon, class, location, title}]` |

### Reload

Reload the table with new parameters:

```javascript
let dt = gcs.bsdt({url: '/JSON/get/data.php', ...});

// Later, reload with new filter values:
dt.reload({Search_Start: '2024-01-01', Search_End: '2024-12-31'});

// With callback:
dt.reload(newParams, () => { console.log('reloaded'); });
```

### Full Example

```javascript
gcs.basejsDone.then(() => {
    gcs.ajaxerror();

    let dt = gcs.bsdt({
        url: '/JSON/get/agent-list.php',
        parent: '#tableContainer',
        example: {Agent_FK: '', Agent_Name: '', Manager_Name: ''},
        column: ['Agent_FK', 'Agent_Name', 'Manager_Name'],
        header: ['ID', 'Name', 'Manager'],  // 'ID' auto-hides the first column
        render: 'text()',
        paging: true,
        order: [{name: 'Agent_Name', dir: 'asc'}],
        edit: (row) => {
            $('#edit [name="Agent_FK"]').val(row.Agent_FK);
            $('#edit [name="Agent_Name"]').val(row.Agent_Name);
            $('#edit').modal('show');
        },
        del: (row) => {
            gcs.confirm('Delete this agent?').then(ok => {
                if (ok) $.ajax({
                    type: 'DELETE',
                    url: `api.php/records/Agent/${row.Agent_FK}`,
                    success: () => dt.reload()
                });
            });
        },
        add: () => { $('#add').modal('show'); }
    });
});
```

---

## `gcs.sidebar()` — Filter / Form Panels

Creates a slide-out panel (modal or offcanvas) with form inputs, a submit button, and a reset button.

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `id` | string | `'sidebar'` | Element ID for the sidebar |
| `label` | string | `''` | Title displayed in the header |
| `icon` | string/false | `'fa-cogs'` | FontAwesome icon class for the trigger button, or `false` for no trigger |
| `items` | array | `[]` | Array of form field definitions |
| `sections` | array | `[]` | Grouped sections of items |
| `parent` | string | `'body'` | CSS selector for the parent element |
| `autoopen` | boolean | `false` | Automatically open on creation |
| `closeonsubmit` | boolean | `true` | Close the sidebar on submit |
| `type` | string | `'modal'` | `'modal'` or `'offcanvas'` |
| `placeholders` | boolean | `false` | Use placeholders instead of labels |

### Item Types

Each item in the `items` array is an object describing a form field:

```javascript
{name: 'Search_Start', type: 'date', label: 'Start Date'}
{name: 'Search_End', type: 'date', label: 'End Date'}
{name: 'Search_Agent', type: 'select', label: 'Agent', options: [{text: 'All', value: ''}, ...]}
{name: 'Search_AgentList', type: 'multiselect', label: 'Agents', options: [{text: 'John', value: '1'}, ...]}
{name: 'Search_String', type: 'text', label: 'Search Term'}
```

### Events

The sidebar generates a jQuery element you interact with via events:

```javascript
// Read form values with .val() — returns an object of all field values
$('#filter').on('submit', () => {
    let data = $('#filter').val();
    data.Search_AgentList = JSON.stringify(data.Search_AgentList); // multi-selects need JSON.stringify
    dt.reload(data);
});

// Reset clears all fields
$('#filter').on('reset', () => { dt.reload(); });
```

### Full Example with bsdt

```javascript
gcs.basejsDone.then(() => {
    gcs.ajaxerror();

    // Load filter options
    $.getJSON('/JSON/get/agent-dropdown.php', agents => {
        gcs.sidebar({
            id: 'filter',
            label: 'Report Filter',
            autoopen: true,
            items: [
                {name: 'Search_Start', type: 'date', label: 'Start Date'},
                {name: 'Search_End', type: 'date', label: 'End Date'},
                {name: 'Search_AgentList', type: 'multiselect', label: 'Agents', options: agents}
            ]
        });

        let dt = gcs.bsdt({
            url: '/JSON/get/report.php',
            example: {ID: '', Name: '', Score: 0, Date: ''},
            column: ['ID', 'Name', 'Score', 'Date'],
            header: ['ID', 'Agent', 'Score', 'Date'],
            render: 'text()'
        });

        $('#filter').on('submit', () => {
            let data = $('#filter').val();
            data.Search_AgentList = JSON.stringify(data.Search_AgentList);
            dt.reload(data);
        });
    });
});
```

---

## `gcs.chart.*` — Charts (CanvasJS)

Wrapper around CanvasJS Commercial 3.3.2. Each method has a `Data` variant (pass data directly) and a `URL` variant (fetch from endpoint).

### Bar Chart

```javascript
gcs.chart.buildBarChartURL({
    target: '#chartDiv',          // CSS selector for container div
    title: 'Calls by Department',
    url: '/JSON/get/chart-data.php',
    urlOpts: {month: '2024-01'}, // optional GET params
    optsOverride: {}             // optional CanvasJS overrides
});
```

The JSON endpoint should return `[{Label: "Sales", Count: 150}, ...]` — the first column becomes the X axis label, the second becomes the Y value.

### Multi-Line Chart

```javascript
gcs.chart.buildMultiLineChartURL({
    target: '#chartDiv',
    title: 'Agent Scores Over Time',
    url: '/JSON/get/chart-line.php',
    urlOpts: {},                  // optional GET params
    key: 'AgentName',            // field that distinguishes each line
    x: 'Date',                   // X-axis field
    xDate: true,                 // parse X values as dates
    y: 'Score',                  // Y-axis field
    showLegend: true,            // show/hide legend
    optsOverride: {}             // optional CanvasJS overrides
});
```

The JSON endpoint should return flat rows: `[{AgentName: "John", Date: "2024-01-01", Score: 95}, ...]`. The `key` field groups rows into separate lines.

**For a single line**, use `buildMultiLineChartURL` with a constant key field and `showLegend: false`:

```javascript
gcs.chart.buildMultiLineChartURL({
    target: '#chartDiv',
    title: 'Overall Score Trend',
    url: '/JSON/get/score-trend.php',
    key: 'Label',       // a constant value in every row, e.g. "Score"
    x: 'Date',
    xDate: true,
    y: 'Score',
    showLegend: false
});
```

### Pie / Doughnut Chart

```javascript
gcs.chart.buildPieChartURL({
    target: '#chartDiv',
    title: 'Score Distribution',
    url: '/JSON/get/pie-data.php',
    showTotal: true,      // show sum subtitle
    optsOverride: {}
});

gcs.chart.buildDoughnutChartURL({
    target: '#chartDiv',
    title: 'Category Breakdown',
    url: '/JSON/get/doughnut-data.php',
    showTotal: true,
    optsOverride: {}
});
```

**Important**: `buildLineChartURL` does **NOT** exist. Always use `buildMultiLineChartURL`.

### Available Chart Methods

| Method | Description |
|---|---|
| `gcs.chart.buildBarChartURL(opts)` | Bar/column chart from URL |
| `gcs.chart.buildBarChartData(opts)` | Bar/column chart from data |
| `gcs.chart.buildMultiLineChartURL(opts)` | Multi-line chart from URL |
| `gcs.chart.buildMultiLineChartData(opts)` | Multi-line chart from data |
| `gcs.chart.buildPieChartURL(opts)` | Pie chart from URL |
| `gcs.chart.buildPieChartData(opts)` | Pie chart from data |
| `gcs.chart.buildDoughnutChartURL(opts)` | Doughnut chart from URL |
| `gcs.chart.buildDoughnutChartData(opts)` | Doughnut chart from data |

---

## Other `gcs` Utilities

### Toast Notifications

```javascript
gcs.toast({message: 'Saved successfully', type: 'success'});
gcs.toast({message: 'Something went wrong', type: 'danger'});
// types: success, danger, warning, info
```

### Modal Dialogs (Promise-based)

```javascript
await gcs.alert('Record saved.');
let ok = await gcs.confirm('Delete this record?');
let name = await gcs.prompt('Enter agent name:', 'Default');
gcs.errorModal('Error details here');
```

### Theme

```javascript
gcs.setTheme('dark');    // or 'light'
gcs.toggleTheme();
```

---

## Full Page Template

```php
<?php require_once $_SERVER['DOCUMENT_ROOT'] . "/base.php"; ?>
<!DOCTYPE html>
<html>
<head>
    <title>My Report</title>
    <script src="/script/BaseJS/basejs.js"></script>
</head>
<body>
<span id="bar" class="hidden"></span> <!-- required for sidebar in iframe pages -->
<div id="tableContainer" class="p-3"></div>
<div id="chartContainer" style="height:300px"></div>

<script>
gcs.basejsDone.then(() => {
    gcs.ajaxerror();

    // Sidebar filter
    gcs.sidebar({
        id: 'filter',
        label: 'Filters',
        autoopen: true,
        items: [
            {name: 'Start', type: 'date', label: 'Start Date'},
            {name: 'End', type: 'date', label: 'End Date'}
        ]
    });

    // Data table
    let dt = gcs.bsdt({
        parent: '#tableContainer',
        url: '/JSON/get/my-report.php',
        example: {ID: '', Name: '', Score: 0},
        column: ['ID', 'Name', 'Score'],
        header: ['ID', 'Agent', 'Score'],
        render: 'text()',
        paging: true
    });

    // Chart
    gcs.chart.buildBarChartURL({
        target: '#chartContainer',
        title: 'Scores by Agent',
        url: '/JSON/get/my-chart.php'
    });

    // Wire sidebar submit to reload table
    $('#filter').on('submit', () => {
        let data = $('#filter').val();
        dt.reload(data);
    });
});
</script>
</body>
</html>
```

## Adding a Page to Navigation

In `index.php`, add a button inside the appropriate collapsible section:

```html
<button data-href="mypage.php" class="btn btn-link nav-btn w-100 text-start">
    <i class="fa fa-chart-bar fa-fw"></i> My Report
</button>
```

## PHP-CRUD-API

For simple CRUD operations, use the built-in REST API at `/api.php/records/{Table}`:

```javascript
// Create
$.post('api.php/records/Agent', {Agent_Name: 'John', Agent_Manager: '5'});

// Read
$.getJSON('api.php/records/Agent/123');

// Update
$.ajax({type: 'PUT', url: 'api.php/records/Agent/123', data: {Agent_Name: 'Jane'}});

// Delete
$.ajax({type: 'DELETE', url: 'api.php/records/Agent/123'});
```
