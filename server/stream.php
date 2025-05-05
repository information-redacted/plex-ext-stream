<?php
define('UPLOAD_DIR', __DIR__ . '/stream/');
define('PASSWORD', 'changeme'); // Change this!
header("Access-Control-Allow-Origin: *"); // Replace '*' with your specific domain if needed

if (!file_exists(UPLOAD_DIR)) {
    mkdir(UPLOAD_DIR, 0777, true);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['h'])) {
    $file = basename($_GET['h']); // Prevent path traversal
    $path = __DIR__ . "/stream/$file";
    if (is_file($path)) {
        $url = trim(file_get_contents($path));
        header("Location: $url");
        exit;
    }
    http_response_code(404);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!isset($_POST['password']) || $_POST['password'] !== PASSWORD) {
        header('HTTP/1.1 403 Forbidden');
        echo 'Invalid password';
        exit;
    }

    if (!isset($_POST['content']) || empty($_POST['content'])) {
        header('HTTP/1.1 400 Bad Request');
        echo 'No content provided';
        exit;
    }

    $mode = "mpd";
    if (isset($_POST['mode'])) {
        $mode=$_POST['mode'];
        if ($mode != "mpd" && $mode != "m3u8") {
            header('HTTP/1.1 400 Bad Request');
            echo 'Invalid mode';
            exit;
        }
    }

    $filename = uniqid('_', true) . '.mpd';
    $filepath = UPLOAD_DIR . $filename;

    file_put_contents($filepath, $_POST['content']);

    // Return the URL to the created paste
    $base_url = sprintf(
        "%s://%s%s",
        isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' ? 'https' : 'http',
        $_SERVER['HTTP_HOST'],
        dirname($_SERVER['SCRIPT_NAME'])
    );

    if ($mode === "mpd") {
        echo $base_url . '/stream/' . $filename;
    } else {
        echo $base_url . basename(__FILE__) .'?h=' . $filename;
    }
    exit;
}

echo 'This is a simple pastebin. Use POST with password and content to upload.';
?>