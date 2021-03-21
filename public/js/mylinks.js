function isURL(str) {
    var pattern = new RegExp('^(https?:\\/\\/)?'+ // protocol
        '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|'+ // domain name
        '((\\d{1,3}\\.){3}\\d{1,3}))'+ // OR ip (v4) address
        '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*'+ // port and path
        '(\\?[;&a-z\\d%_.~+=-]*)?'+ // query string
        '(\\#[-a-z\\d_]*)?$','i'); // fragment locator
    return !!pattern.test(str);
}
async function handleEdit(name, url) {
    let newURL;
    while (!isURL(newURL)) {
        newURL = prompt("Please enter a valid new URL", url);
        if (newURL === null) {
            return
        }
    }
    const response = await fetch(`/updateLink?name=${name}&url=${newURL}`, {
        method: "PUT"
    })
    if (response.status !== 200) {
        alert(parsed.message)
    } else  {
        alert(`URL changed to ${newURL}!`)
        document.getElementById(`urldata-${name}-url`).innerHTML = newURL
        document.getElementById(`urldata-${name}-url`).href = newURL
    }
}