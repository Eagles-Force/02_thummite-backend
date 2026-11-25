export const generateSlug = (text) => {
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')        // spaces to hyphens
        .replace(/[&\/\\#,+()$~%.'"*?<>{}]/g, '') // remove special chars
        .replace(/--+/g, '-')        // remove double hyphens
}