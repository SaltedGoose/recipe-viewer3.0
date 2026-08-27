import { animate } from "./anime.esm.min.js";
import { createClient } from "./supabase.js";

// ======================================================
// SUPABASE
// ======================================================

const SUPABASE_URL =
    "https://iypgxapqiforaqjswnmk.supabase.co";

const SUPABASE_KEY =
    "sb_publishable_RbinenO0faAHTVlXaev44Q_Lhb6PdP3";

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

// ======================================================
// INDEXEDDB
// ======================================================

let db;

let allRecipesByType = {
    "Starters": [],
    "Mains": [],
    "Deserts": []
};

let allRecipes;
let oldRecipeURL;

const DB_NAME = "recipeDB";
const DB_VERSION = 1;
const STORE_NAME = "recipes";

const request = indexedDB.open(
    DB_NAME,
    DB_VERSION
);

// ======================================================
// CREATE DATABASE / OBJECT STORE
// ======================================================

request.onupgradeneeded = function (event) {

    db = event.target.result;

    if (!db.objectStoreNames.contains(STORE_NAME)) {

        const store = db.createObjectStore(
            STORE_NAME,
            {
                keyPath: "id",
                autoIncrement: true
            }
        );

        store.createIndex(
            "name",
            "name",
            {
                unique: false
            }
        );

        store.createIndex(
            "type",
            "type",
            {
                unique: false
            }
        );
    }
};

// ======================================================
// DATABASE CONNECTED
// ======================================================

request.onsuccess = async function (event) {

    db = event.target.result;

    console.log("IndexedDB connected");

    if (navigator.onLine) {

        await readDB("Update");

    }

    else {

        await readDB("Read");

    }
};

// ======================================================
// DATABASE ERROR
// ======================================================

request.onerror = function (event) {

    console.error(
        "IndexedDB error:",
        event.target.error
    );
};

// ======================================================
// RETRIEVE FROM SUPABASE
// ======================================================

async function getRecipesFromSupabase() {

    const { data, error } = await supabase
        .from("recipes")
        .select("*");

    if (error) {

        console.error(
            "Error getting recipes:",
            error
        );

        return null;
    }

    console.log(
        "Recipes downloaded from Supabase:",
        data
    );

    return data;
}

// ======================================================
// GET IMAGE FROM SUPABASE
// ======================================================

async function getImageFromSupabse(imageURL) {

    const { data, error } = await supabase.storage
        .from("recipe-images")
        .download(imageURL);

    if (error) {

        console.error(
            "Image download failed:",
            error
        );

        return null;
    }

    console.log(
        "Image downloaded successfully",
        data
    );

    return data;
}

// ======================================================
// WRITE TO SUPABASE
// ======================================================

async function writeToSupabase(recipe) {

    try {

        // --------------------------------------------------
        // Make sure the image exists
        // --------------------------------------------------

        if (!recipe.image) {

            console.error(
                "Recipe has no image:",
                recipe.name
            );

            return false;
        }

        // --------------------------------------------------
        // Get image extension from MIME type
        // --------------------------------------------------

        let extension = "jpg";

        if (recipe.image.type) {

            const mimeType =
                recipe.image.type.toLowerCase();

            if (mimeType === "image/jpeg") {
                extension = "jpg";
            }

            else if (mimeType === "image/png") {
                extension = "png";
            }

            else if (mimeType === "image/webp") {
                extension = "webp";
            }

            else if (mimeType === "image/gif") {
                extension = "gif";
            }

            else {

                const possibleExtension =
                    mimeType.split("/")[1];

                if (possibleExtension) {
                    extension = possibleExtension;
                }
            }
        }

        const imagePath =
            `${recipe.id}.${extension}`;

        console.log(
            "Uploading image:",
            imagePath
        );

        // --------------------------------------------------
        // Upload image
        // --------------------------------------------------

        const { error: imageError } =
            await supabase.storage
                .from("recipe-images")
                .upload(
                    imagePath,
                    recipe.image
                );

        if (imageError) {

            console.error(
                "Image upload failed:",
                imageError
            );

            return false;
        }

        console.log(
            "Image uploaded:",
            imagePath
        );

        // --------------------------------------------------
        // Make copy without image
        // --------------------------------------------------

        const recipeForSupabase = {

            id: recipe.id,

            type: recipe.type,

            name: recipe.name,

            description: recipe.description,

            ingredients: recipe.ingredients,

            instructions: recipe.instructions,

            image_path: imagePath
        };

        // --------------------------------------------------
        // Upload recipe data
        // --------------------------------------------------

        const { error: recipeError } =
            await supabase
                .from("recipes")
                .insert(
                    recipeForSupabase
                );

        if (recipeError) {

            console.error(
                "Recipe upload failed:",
                recipeError
            );

            // Remove orphaned image

            const { error: deleteError } =
                await supabase.storage
                    .from("recipe-images")
                    .remove([
                        imagePath
                    ]);

            if (deleteError) {

                console.error(
                    "Failed to remove orphaned image:",
                    deleteError
                );

            }

            return false;
        }

        console.log(
            "Recipe uploaded to Supabase:",
            recipe.name
        );

        return true;

    }

    catch (error) {

        console.error(
            "Unexpected Supabase upload error:",
            error
        );

        return false;
    }
}

// ======================================================
// UPLOAD PENDING RECIPES
// ======================================================

async function uploadPendingRecipes(indexDBRecipes) {

    const pendingRecipes =
        indexDBRecipes.filter(
            recipe =>
                recipe.status === "Pending"
        );

    if (pendingRecipes.length === 0) {

        console.log(
            "No pending recipes to upload."
        );

        return;
    }

    console.log(
        `${pendingRecipes.length} pending recipes found.`
    );

    for (const recipe of pendingRecipes) {

        console.log(
            "Uploading pending recipe:",
            recipe.name
        );

        const success =
            await writeToSupabase(recipe);

        if (success) {

            recipe.status = "Synced";

            await updateRecipeInDB(recipe);

            console.log(
                `Successfully uploaded: ${recipe.name}`
            );
        }

        else {

            console.log(
                `Failed to upload: ${recipe.name}`
            );
        }
    }
}

// ======================================================
// UPDATE RECIPE IN INDEXEDDB
// ======================================================

function updateRecipeInDB(recipe) {

    return new Promise((resolve, reject) => {

        const transaction =
            db.transaction(
                [STORE_NAME],
                "readwrite"
            );

        const objectStore =
            transaction.objectStore(
                STORE_NAME
            );

        const request =
            objectStore.put(recipe);

        request.onsuccess = () => {

            console.log(
                "IndexedDB recipe updated:",
                recipe.name
            );

            resolve();
        };

        request.onerror = event => {

            console.error(
                "IndexedDB update failed:",
                event.target.error
            );

            reject(
                event.target.error
            );
        };
    });
}

// ======================================================
// LOAD RECIPES FROM SUPABASE INTO INDEXEDDB
// ======================================================

async function loadIndexDBRecipes(currentRecipes) {

    const retrievedRecipes =
        await getRecipesFromSupabase();

    if (!retrievedRecipes) {

        await readDB("Read");

        return;
    }

    const newRecipes =
        retrievedRecipes.filter(
            supabaseRecipe =>
                !currentRecipes.some(
                    localRecipe =>
                        localRecipe.id ===
                        supabaseRecipe.id
                )
        );

    const recipesToAdd =
        await Promise.all(

            newRecipes.map(
                async recipe => {

                    const imageFile =
                        await getImageFromSupabse(
                            recipe.image_path
                        );

                    if (!imageFile) {

                        console.error(
                            `Skipping ${recipe.name} because its image could not be downloaded.`
                        );

                        return null;
                    }

                    delete recipe.image_path;

                    recipe.image =
                        imageFile;

                    recipe.status =
                        "Synced";

                    return recipe;
                }
            )
        );

    const validRecipes =
        recipesToAdd.filter(
            recipe => recipe !== null
        );

    console.log(
        `${validRecipes.length} recipes ready to add`
    );

    if (validRecipes.length === 0) {

        await readDB("Read");

        return;
    }

    await new Promise(
        (resolve, reject) => {

            const transaction =
                db.transaction(
                    [STORE_NAME],
                    "readwrite"
                );

            const objectStore =
                transaction.objectStore(
                    STORE_NAME
                );

            transaction.oncomplete =
                () => {

                    console.log(
                        "Transaction Complete"
                    );

                    resolve();
                };

            transaction.onerror =
                event => {

                    console.error(
                        "Transaction Error:",
                        event.target.error
                    );

                    reject(
                        event.target.error
                    );
                };

            validRecipes.forEach(
                recipe => {

                    objectStore.add(recipe);

                }
            );
        }
    );

    await readDB("Read");
}

// ======================================================
// READ INDEXEDDB
// ======================================================

function readDB(readStatus) {

    return new Promise(
        (resolve, reject) => {

            const transaction =
                db.transaction(
                    [STORE_NAME],
                    "readonly"
                );

            const objectStore =
                transaction.objectStore(
                    STORE_NAME
                );

            const request =
                objectStore.getAll();

            request.onsuccess =
                async function () {

                    try {

                        if (
                            readStatus ===
                            "Update"
                        ) {

                            await uploadPendingRecipes(
                                request.result
                            );

                            await loadIndexDBRecipes(
                                request.result
                            );

                        }

                        else if (
                            readStatus ===
                            "Read"
                        ) {

                            allRecipes =
                                request.result;

                            groupRecipesByType();

                            loadInitRecipes();
                        }

                        resolve();

                    }

                    catch (error) {

                        console.error(
                            "readDB error:",
                            error
                        );

                        reject(error);
                    }
                };

            request.onerror =
                function () {

                    console.error(
                        "Error reading database!"
                    );

                    reject(
                        request.error
                    );
                };
        }
    );
}

// ======================================================
// GROUP RECIPES BY TYPE
// ======================================================

function groupRecipesByType() {

    allRecipesByType.Starters = [];
    allRecipesByType.Mains = [];
    allRecipesByType.Deserts = [];

    allRecipes.forEach(recipe => {

        if (recipe.type === "Starter") {

            allRecipesByType.Starters.push(
                recipe
            );

        }

        else if (recipe.type === "Main") {

            allRecipesByType.Mains.push(
                recipe
            );

        }

        else if (recipe.type === "Desert") {

            allRecipesByType.Deserts.push(
                recipe
            );
        }
    });
}

// ======================================================
// LOAD INITIAL RECIPES
// ======================================================

function loadInitRecipes() {

    let currentTypeIndex = 0;

    let types = [
        "Starters",
        "Mains",
        "Deserts"
    ];

    $(".food-section").each(function () {

        const recipeArray =
            allRecipesByType[
                types[currentTypeIndex]
            ];

        if (
            !recipeArray ||
            recipeArray.length === 0
        ) {

            currentTypeIndex++;

            return;
        }

        const initRecipe =
            recipeArray[0];

        const initRecipeName =
            initRecipe.name;

        if (!initRecipe.image) {

            currentTypeIndex++;

            return;
        }

        const initImageURL =
            URL.createObjectURL(
                initRecipe.image
            );

        $(this)
            .find("h3")
            .text(initRecipeName);

        const imgToUpdate =
            $(this)
                .find("div")
                .find("img");

        imgToUpdate.attr(
            "src",
            initImageURL
        );

        imgToUpdate.attr(
            "alt",
            initRecipeName
        );

        currentTypeIndex++;
    });
}

// ======================================================
// NAVIGATION
// ======================================================

let navBarExpanded = false;

function hideBottomNav() {

    animate("#bottom-nav", {

        opacity: 0,

        translateY: -10,

        duration: 900,

        ease: "in(3)",

        oncomplete: function () {

            $("#bottom-nav").css(
                "pointer-events",
                "none"
            );
        }
    });

    navBarExpanded = false;
}

$("#burger-button").on(
    "click",
    function () {

        if (!navBarExpanded) {

            $("#bottom-nav").css(
                "pointer-events",
                "auto"
            );

            animate("#bottom-nav", {

                opacity: 1,

                translateY: 0,

                duration: 1000,

                ease: "out(3)"
            });

            navBarExpanded = true;
        }

        else {

            hideBottomNav();
        }
    }
);

$("#home-button").on(
    "click",
    function () {

        location.reload();

    }
);

// ======================================================
// CAROUSEL
// ======================================================

function moveCarousel(
    button,
    direction
) {

    const type =
        $(button).data("type");

    const recipeArray =
        allRecipesByType[type];

    const currentImage =
        $(button)
            .parent()
            .find("img");

    const oldURL =
        currentImage.attr("src");

    const currentRecipeHeading =
        $(button)
            .parent()
            .parent()
            .find("h3");

    const currentRecipeName =
        currentImage.attr("alt");

    let currentIndex =
        recipeArray.findIndex(
            recipe =>
                recipe.name ===
                currentRecipeName
        );

    currentIndex += direction;

    if (currentIndex === -1) {

        currentIndex =
            recipeArray.length - 1;
    }

    else if (
        currentIndex >=
        recipeArray.length
    ) {

        currentIndex = 0;
    }

    const newRecipe =
        recipeArray[currentIndex];

    const imageURL =
        URL.createObjectURL(
            newRecipe.image
        );

    if (
        oldURL &&
        oldURL.startsWith("blob:")
    ) {

        URL.revokeObjectURL(
            oldURL
        );
    }

    currentImage.attr(
        "src",
        imageURL
    );

    currentImage.attr(
        "alt",
        newRecipe.name
    );

    currentRecipeHeading.text(
        newRecipe.name
    );
}

// ======================================================
// FORWARD
// ======================================================

$(".fwd").on(
    "click",
    function () {

        moveCarousel(
            $(this),
            1
        );
    }
);

// ======================================================
// BACKWARD
// ======================================================

$(".rwd").on(
    "click",
    function () {

        moveCarousel(
            $(this),
            -1
        );
    }
);

// ======================================================
// SELECT RECIPE
// ======================================================

$(".food-img").on(
    "click",
    function () {

        const type =
            $(this)
                .parent()
                .find(".rwd")
                .data("type");

        const name =
            $(this).attr("alt");

        const foundRecipe =
            allRecipesByType[type]
                .find(
                    recipe =>
                        recipe.name ===
                        name
                );

        if (foundRecipe) {

            showRecipe(
                foundRecipe
            );
        }
    }
);

// ======================================================
// SHOW RECIPE
// ======================================================

function showRecipe(foundRecipe) {

    const oldURL =
        $("#show-recipe-image")
            .attr("src");

    $("#show-recipe-name")
        .text(foundRecipe.name);

    if (foundRecipe.image) {

        const newImageURL =
            URL.createObjectURL(
                foundRecipe.image
            );

        $("#show-recipe-image")
            .attr(
                "src",
                newImageURL
            )
            .attr(
                "alt",
                foundRecipe.name
            );
    }

    if (
        oldURL &&
        oldURL.startsWith("blob:")
    ) {

        URL.revokeObjectURL(
            oldURL
        );
    }

    $("#show-recipe-description")
        .text(
            foundRecipe.description
        );

    let ingredients =
        $("#show-recipe-ingredients");

    ingredients.empty();

    foundRecipe.ingredients.forEach(
        ingredient => {

            let nextIngredient =
                $("<li>");

            nextIngredient.text(
                ingredient
            );

            ingredients.append(
                nextIngredient
            );
        }
    );

    let instructions =
        $("#show-recipe-instructions");

    instructions.empty();

    foundRecipe.instructions.forEach(
        instruction => {

            let nextInstruction =
                $("<li>");

            nextInstruction.text(
                instruction
            );

            instructions.append(
                nextInstruction
            );
        }
    );

    $("#show-recipe")
        .css(
            "display",
            "flex"
        );

    animate("#show-recipe", {

        opacity: 1,

        duration: 1000,

        ease: "out(3)",

        oncomplete: function () {

            $("nav").css(
                "filter",
                "blur(5px)"
            );

            $("main").css(
                "filter",
                "blur(5px)"
            );

            hideBottomNav();
        }
    });
}

// ======================================================
// CLOSE RECIPE
// ======================================================

$("#close-recipe").on(
    "click",
    function () {

        animate("#show-recipe", {

            opacity: 0,

            duration: 1000,

            ease: "out(3)",

            oncomplete: function () {

                $("nav").css(
                    "filter",
                    "blur(0px)"
                );

                $("main").css(
                    "filter",
                    "blur(0px)"
                );

                $("#show-recipe").css(
                    "display",
                    "none"
                );
            }
        });
    }
);

// ======================================================
// SEARCH
// ======================================================

$("#search").on(
    "click",
    function () {

        $("#result-display")
            .find("img")
            .each(function () {

                const imageURL =
                    $(this).attr("src");

                if (
                    imageURL &&
                    imageURL.startsWith("blob:")
                ) {

                    URL.revokeObjectURL(
                        imageURL
                    );
                }
            });

        $("#result-display").empty();

        const recipeInput =
            $("#recipe-search");

        const recipeToSearch =
            recipeInput
                .val()
                .trim()
                .toLowerCase();

        if (recipeToSearch === "") {
            return;
        }

        const wordsToSearch =
            recipeToSearch
                .split(/\s+/);

        const foundRecipes =
            allRecipes.filter(
                recipe => {

                    return wordsToSearch.some(
                        word =>

                            recipe.name
                                .toLowerCase()
                                .includes(word)

                            ||

                            recipe.description
                                .toLowerCase()
                                .includes(word)

                            ||

                            recipe.ingredients.some(
                                ingredient =>
                                    ingredient
                                        .toLowerCase()
                                        .includes(word)
                            )
                    );
                }
            );

        recipeInput.val("");

        if (
            foundRecipes.length === 0
        ) {

            const errorHeading =
                $("<h3>");

            errorHeading.text(
                `No Recipes found containing: ${recipeToSearch}`
            );

            $("#result-display")
                .append(
                    errorHeading
                );
        }

        else {

            foundRecipes.forEach(
                recipe => {

                    const imageURL =
                        recipe.image
                            ? URL.createObjectURL(
                                recipe.image
                            )
                            : "";

                    let html = `

                        <div class="result">

                            <div class="result-description">

                                <h3>${recipe.name}</h3>

                                <p>${recipe.description}</p>

                            </div>

                            <img
                                class="result-img"
                                src="${imageURL}"
                                alt="${recipe.name}"
                            >

                        </div>

                    `;

                    $("#result-display")
                        .append(html);
                }
            );
        }

        $("#recipe-search-results")
            .css(
                "display",
                "flex"
            );

        animate(
            "#recipe-search-results",
            {

                opacity: 1,

                duration: 1000,

                ease: "out(3)",

                oncomplete: function () {

                    $("nav").css(
                        "filter",
                        "blur(5px)"
                    );

                    $("main").css(
                        "filter",
                        "blur(5px)"
                    );

                    hideBottomNav();
                }
            }
        );
    }
);

// ======================================================
// HIDE SEARCH RESULTS
// ======================================================

function hideRecipeSearchResults() {

    animate(
        "#recipe-search-results",
        {

            opacity: 0,

            duration: 1000,

            ease: "out(3)",

            oncomplete: function () {

                $("nav").css(
                    "filter",
                    "blur(0px)"
                );

                $("main").css(
                    "filter",
                    "blur(0px)"
                );

                $("#recipe-search-results")
                    .css(
                        "display",
                        "none"
                    );
            }
        }
    );
}

// ======================================================
// SELECT SEARCH RESULT
// ======================================================

$("#result-display").on(
    "click",
    ".result",
    function () {

        const foundRecipe =
            allRecipes.find(
                recipe =>
                    recipe.name ===
                    $(this)
                        .find("h3")
                        .text()
            );

        if (foundRecipe) {

            hideRecipeSearchResults();

            showRecipe(
                foundRecipe
            );
        }
    }
);

// ======================================================
// CLOSE SEARCH
// ======================================================

$("#result-close").on(
    "click",
    function () {

        hideRecipeSearchResults();

    }
);

// ======================================================
// ADD NEW RECIPES
// ======================================================

let recipeError = false;

function closeAddRecipe() {

    animate(
        "#add-new-recipe",
        {

            opacity: 0,

            duration: 1000,

            ease: "out(3)",

            oncomplete: function () {

                $("nav").css(
                    "filter",
                    "blur(0px)"
                );

                $("main").css(
                    "filter",
                    "blur(0px)"
                );

                $("#add-new-recipe")
                    .css(
                        "display",
                        "none"
                    );

                recipeError = false;

                location.reload();
            }
        }
    );
}

// ======================================================
// OPEN ADD RECIPE
// ======================================================

$("#add-button").on(
    "click",
    function () {

        $("#add-new-recipe")
            .css(
                "display",
                "flex"
            );

        animate(
            "#add-new-recipe",
            {

                opacity: 1,

                duration: 1000,

                ease: "out(3)",

                oncomplete: function () {

                    $("nav").css(
                        "filter",
                        "blur(5px)"
                    );

                    $("main").css(
                        "filter",
                        "blur(5px)"
                    );

                    hideBottomNav();
                }
            }
        );
    }
);

// ======================================================
// IMAGE BUTTON
// ======================================================

$("#recipe-image-button").on(
    "click",
    function () {

        $("#recipe-image-input")
            .click();

    }
);

// ======================================================
// RECIPE ERROR
// ======================================================

function showRecipeError(input) {

    input.css(
        "border-color",
        "red"
    );

    recipeError = true;
}

// ======================================================
// SUBMIT NEW RECIPE
// ======================================================

$("#submit-new-recipe").on(
    "click",
    async function () {

        recipeError = false;

        const recipeName =
            $("#new-recipe-name").val();

        const recipeType =
            $("#new-recipe-type").val();

        const recipeDescription =
            $("#new-recipe-description").val();

        const recipeIngredients =
            $("#new-recipe-ingredients").val();

        const recipeInstructions =
            $("#new-recipe-instructions").val();

        const imageInput =
            $("#recipe-image-input");

        // --------------------------------------------------
        // VALIDATION
        // --------------------------------------------------

        if (
            recipeName.trim() === ""
        ) {

            showRecipeError(
                $("#new-recipe-name")
            );
        }

        if (!recipeType) {

            showRecipeError(
                $("#new-recipe-type")
            );
        }

        if (
            recipeDescription.trim() === ""
        ) {

            showRecipeError(
                $("#new-recipe-description")
            );
        }

        if (
            recipeIngredients.trim() === ""
        ) {

            showRecipeError(
                $("#new-recipe-ingredients")
            );
        }

        if (
            recipeInstructions.trim() === ""
        ) {

            showRecipeError(
                $("#new-recipe-instructions")
            );
        }

        if (
            imageInput[0].files.length === 0
        ) {

            showRecipeError(
                $("#recipe-image-button")
            );
        }

        if (recipeError === true) {
            return;
        }

        // --------------------------------------------------
        // CREATE RECIPE
        // --------------------------------------------------

        const selectedImage =
            imageInput[0].files[0];

        const newRecipeToAdd = {

            id:
                crypto.randomUUID(),

            type:
                recipeType,

            name:
                recipeName,

            description:
                recipeDescription,

            ingredients:
                recipeIngredients
                    .split("\n")
                    .map(
                        line =>
                            line.trim()
                    )
                    .filter(
                        line =>
                            line !== ""
                    ),

            instructions:
                recipeInstructions
                    .split("\n")
                    .map(
                        line =>
                            line.trim()
                    )
                    .filter(
                        line =>
                            line !== ""
                    ),

            image:
                selectedImage,

            status:
                "Pending"
        };

        // --------------------------------------------------
        // SAVE TO INDEXEDDB FIRST
        // --------------------------------------------------

        try {

            await new Promise(
                (resolve, reject) => {

                    const transaction =
                        db.transaction(
                            [STORE_NAME],
                            "readwrite"
                        );

                    const objectStore =
                        transaction.objectStore(
                            STORE_NAME
                        );

                    const request =
                        objectStore.add(
                            newRecipeToAdd
                        );

                    request.onsuccess =
                        () => {

                            console.log(
                                "Recipe saved to IndexedDB:",
                                newRecipeToAdd.name
                            );
                        };

                    transaction.oncomplete =
                        () => {

                            console.log(
                                "Recipe IndexedDB transaction complete"
                            );

                            resolve();
                        };

                    transaction.onerror =
                        event => {

                            console.error(
                                "IndexedDB transaction error:",
                                event.target.error
                            );

                            reject(
                                event.target.error
                            );
                        };
                }
            );

        }

        catch (error) {

            console.error(
                "Failed to save recipe to IndexedDB:",
                error
            );

            return;
        }

        // --------------------------------------------------
        // TRY SUPABASE IF ONLINE
        // --------------------------------------------------

        if (navigator.onLine) {

            const synced =
                await writeToSupabase(
                    newRecipeToAdd
                );

            if (synced) {

                newRecipeToAdd.status =
                    "Synced";

                await updateRecipeInDB(
                    newRecipeToAdd
                );

            }

            else {

                console.log(
                    "Recipe remains Pending."
                );
            }
        }

        else {

            console.log(
                "Offline. Recipe remains Pending."
            );
        }

        // --------------------------------------------------
        // REFRESH
        // --------------------------------------------------

        await readDB("Read");

        closeAddRecipe();
    }
);

// ======================================================
// IMAGE SELECTED
// ======================================================

$("#recipe-image-input").on(
    "change",
    function () {

        if (
            this.files.length === 0
        ) {
            return;
        }

        if (
            oldRecipeURL &&
            oldRecipeURL.startsWith("blob:")
        ) {

            URL.revokeObjectURL(
                oldRecipeURL
            );
        }

        const selectedImage =
            this.files[0];

        const imageURL =
            URL.createObjectURL(
                selectedImage
            );

        oldRecipeURL =
            imageURL;

        $("#recipe-image-preview")
            .attr(
                "src",
                imageURL
            )
            .css(
                "display",
                "block"
            );

        $("#recipe-image-button")
            .css(
                "border",
                "3px solid #7CD5C7"
            );
    }
);

// ======================================================
// CANCEL RECIPE
// ======================================================

$("#cancel-recipe").on(
    "click",
    function () {

        closeAddRecipe();

    }
);