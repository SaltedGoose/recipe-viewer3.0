import { animate } from "./anime.esm.min.js";
import { createClient } from "./supabase.js";

// ======================================================
// SUPABASE
// ======================================================

const SUPABASE_URL = "https://iypgxapqiforaqjswnmk.supabase.co";
const SUPABASE_KEY = "sb_publishable_RbinenO0faAHTVlXaev44Q_Lhb6PdP3";

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

// ======================================================
// INDEXEDDB
// ======================================================

let db;
let allRecipesByType = {
    "Starters" : [],
    "Mains" : [],
    "Deserts" : []
};
let allRecipes;
let oldRecipeURL;

const DB_NAME = "recipeDB";
const DB_VERSION = 1;
const STORE_NAME = "recipes";

const request = indexedDB.open(DB_NAME, DB_VERSION);

// ======================================================
// CREATE DATABASE / OBJECT STORE
// ======================================================

request.onupgradeneeded = function (event) {

    db = event.target.result;

    if (!db.objectStoreNames.contains(STORE_NAME)) {

        const store = db.createObjectStore(STORE_NAME, {
            keyPath: "id",
            autoIncrement: true
        });

        // Allows recipes to be searched by name
        store.createIndex("name", "name", {
            unique: false
        });

        // Allows recipes to be searched by type
        store.createIndex("type", "type", {
            unique: false
        });

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
    else{
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
// Retrieve from Supabase
// ======================================================

async function getRecipesFromSupabase() {
    const { data, error } = await supabase
        .from("recipes")
        .select("*");

    if (error) {
        console.error("Error getting recipes:", error);
        return;
    }

    console.log("Recipes downloaded from Supabase:", data);

    return data;
}

async function getImageFromSupabse(imageURL) {
    const {data, error} = await supabase.storage
        .from("recipe-images")
        .download(imageURL);
    
    if(error){
        console.error("Image download failed:", error);
        return null;
    }
    else{
        console.log("Image downloaded successfully", data);
    }

    return data;
}

// ======================================================
// Write to Supabase
// ======================================================

async function writeToSupabase(recipe) {
    if (!recipe.image) {
        console.error("No image exists!");
        alert("No image was provided.");
        return false;
    }

    // ======================================================
    // Convert image to Blob
    // ======================================================

    let imageBlob;

    try {

        imageBlob = new Blob(
            [await recipe.image.arrayBuffer()],
            {
                type: recipe.image.type || "image/jpeg"
            }
        );

        console.log("Blob created:", imageBlob);
        console.log("Blob type:", imageBlob.type);
        console.log("Blob size:", imageBlob.size);

    }
    catch (error) {

        console.error("Failed to create image Blob:", error);

        alert(
            "Could not process the image.\n\n" +
            error.message
        );

        return false;
    }

    if (imageBlob.size === 0) {

        console.error("Image Blob is empty!");

        alert("The selected image contains no data.");

        return false;
    }

    // ======================================================
    // Determine file extension
    // ======================================================

    let fileExtension = "jpg";

    if (recipe.image.type === "image/png") {
        fileExtension = "png";
    }
    else if (recipe.image.type === "image/webp") {
        fileExtension = "webp";
    }
    else if (recipe.image.type === "image/jpeg") {
        fileExtension = "jpg";
    }

    const imagePath = `${recipe.id}.${fileExtension}`;

    console.log("Uploading:", imagePath);

    // ======================================================
    // Upload image
    // ======================================================

    const { data: imageData, error: imageError } =
        await supabase.storage
            .from("recipe-images")
            .upload(
                imagePath,
                imageBlob,
                {
                    contentType: imageBlob.type,
                    upsert: false
                }
            );

    if (imageError) {

        console.error("IMAGE UPLOAD FAILED");
        console.error(imageError);

        alert(
            "Image upload failed!\n\n" +
            "Message: " + imageError.message + "\n" +
            "Status: " + imageError.status + "\n" +
            "Status code: " + imageError.statusCode
        );

        return false;
    }

    console.log("Image uploaded successfully!");
    console.log(imageData);

    // ======================================================
    // Upload recipe information
    // ======================================================

    const recipeForSupabase = {

        id: recipe.id,
        type: recipe.type,
        name: recipe.name,
        description: recipe.description,
        ingredients: recipe.ingredients,
        instructions: recipe.instructions,
        image_path: imagePath

    };

    const { error: recipeError } =
        await supabase
            .from("recipes")
            .insert(recipeForSupabase);

    if (recipeError) {

        console.error("Recipe upload failed:", recipeError);

        alert(
            "Recipe upload failed!\n\n" +
            "Message: " + recipeError.message + "\n" +
            "Code: " + recipeError.code + "\n" +
            "Details: " + recipeError.details
        );

        // Remove image if database upload failed
        const { error: deleteError } =
            await supabase.storage
                .from("recipe-images")
                .remove([imagePath]);

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

async function uploadPendingRecipes(indexDBRecipes) {

    const pendingRecipes = indexDBRecipes.filter(recipe => recipe.status === "Pending");

    if (pendingRecipes.length === 0) {
        console.log("No pending recipes to upload.");
        return;
    }

    console.log(`${pendingRecipes.length} pending recipes found.`);

    for (const recipe of pendingRecipes) {
        const success = await writeToSupabase(recipe);
        if (success) {
            console.log(`Successfully uploaded: ${recipe.name}`);

            recipe.status = "Synced";

            const transaction = db.transaction([STORE_NAME],"readwrite");
            const objectStore = transaction.objectStore(STORE_NAME);
            objectStore.put(recipe);
        }
        else {
            console.log(`Failed to upload: ${recipe.name}`);
        }
    }
}

async function loadIndexDBRecipes(currentRecipes) {
    const retrivedRecipes = await getRecipesFromSupabase()
    if(!retrivedRecipes){
        readDB("Read");
        return
    }
    let newRecipes = retrivedRecipes.filter(supabaseRecipe => !currentRecipes.some(localRecipe => localRecipe.id === supabaseRecipe.id));

    const recipesToAdd = await Promise.all(
        newRecipes.map(async (recipe) => {
            const imageFile = await getImageFromSupabse(recipe.image_path)
            if (!imageFile) {
                console.error(
                    `Skipping ${recipe.name} because its image could not be downloaded.`
                );
                return null;
            }
            delete recipe.image_path;
            recipe.image = imageFile;
            recipe.status = "Synced"
            return recipe;
        })
    )

    const validRecipes = recipesToAdd.filter(recipe => recipe !== null);

    console.log(`${validRecipes.length} recipes ready to add`);

    const transaction = db.transaction([STORE_NAME], "readwrite");

    transaction.oncomplete = (event) => {
        console.log("Transaction Complete");
        readDB("Read");
        return;
    }

    transaction.onerror = (event) => {
        console.log("Transaction Error");
    }

    const objectStore = transaction.objectStore(STORE_NAME);
    validRecipes.forEach((recipe) => {
        const request = objectStore.add(recipe);
        request.onsuccess = (event) => {
            console.log(`${event.target.result} added.`)
        }
    })
}

async function readDB(readStatus) {
    const transaction = db.transaction([STORE_NAME]);
    const objectStore = transaction.objectStore(STORE_NAME);
    const request = objectStore.getAll();

    request.onsuccess = async function(){
        if(readStatus === "Update"){
            await uploadPendingRecipes(request.result);
            await loadIndexDBRecipes(request.result);
        }
        else if(readStatus === "Read"){
            allRecipes = request.result;
            groupRecipesByType();
            loadInitRecipes();
        }
    }

    request.onerror = function(){
        console.log("Error reading database!");
    }
}

function groupRecipesByType(){
    allRecipesByType.Starters = [];
    allRecipesByType.Mains = [];
    allRecipesByType.Deserts = [];

    allRecipes.forEach(recipe => {
        if (recipe.type === "Starter"){
            allRecipesByType.Starters.push(recipe);
        }
        else if (recipe.type === "Main"){
            allRecipesByType.Mains.push(recipe);
        }
        else if (recipe.type === "Desert"){
            allRecipesByType.Deserts.push(recipe);
        }
    })
}

function loadInitRecipes(){
    let currentTypeIndex = 0
    let types = ["Starters", "Mains", "Deserts"];

    $(".food-section").each(function(){
        let initRecipe = allRecipesByType[types[currentTypeIndex]][0];
        let initRecipeName = initRecipe.name;
        let initImageURL = URL.createObjectURL(initRecipe.image);

        $(this).find("h3").text(initRecipeName);
        let imgToUpdate = $(this).find("div").find("img");

        imgToUpdate.attr("src", initImageURL);
        imgToUpdate.attr("alt", initRecipeName);

        currentTypeIndex++;
    })
}

let navBarExpanded = false;

function hideBottomNav(){
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

$("#burger-button").on("click", function () {

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

});

$("#home-button").on("click", function(){
    location.reload();
})

// ======================================================
// CAROUSEL
// ===================================================  
function moveCarousel(button, direction) {
    const type = $(button).data("type");

    const recipeArray = allRecipesByType[type];

    const currentImage = button.parent().find("img");
    const oldURL = currentImage.attr("src");
    const currentRecipeHeading = button.parent().parent().find("h3");
    const currentRecipeName = currentImage.attr("alt");

    let currentIndex = recipeArray.findIndex(recipe => recipe.name === currentRecipeName);

    currentIndex += direction;

    if(currentIndex === -1){
        currentIndex = recipeArray.length - 1;
    }
    else if (currentIndex >= recipeArray.length){
        currentIndex = 0;
    }

    const newRecipe = recipeArray[currentIndex];
    const imageURL = URL.createObjectURL(newRecipe.image);
    if (oldURL && oldURL.startsWith("blob:")) {
        URL.revokeObjectURL(oldURL);
    }

    currentImage.attr("src", imageURL);
    currentImage.attr("alt",newRecipe.name);
    currentRecipeHeading.text(newRecipe.name);
}

// ======================================================
// FORWARD
// ======================================================

$(".fwd").on("click", function () {
    moveCarousel($(this), 1);
});

// ======================================================
// BACKWARD
// ======================================================

$(".rwd").on("click", function () {
    moveCarousel($(this), -1);
});

// ======================================================
// Select Recipe
// ======================================================
$(".food-img").on("click", function(){
    const type = $(this).parent().find(".rwd").data("type");
    const name = $(this).attr("alt");
    const foundRecipe = allRecipesByType[type].find(recipe => recipe.name === name);

    showRecipe(foundRecipe);
})

function showRecipe(foundRecipe){
    const oldURL = $("#show-recipe-image").attr("src");
    $("#show-recipe-name").text(foundRecipe.name);
    $("#show-recipe-image").attr("src", URL.createObjectURL(foundRecipe.image)).attr("alt", foundRecipe.name);
    if (oldURL && oldURL.startsWith("blob:")) {
        URL.revokeObjectURL(oldURL);
    }
    $("#show-recipe-description").text(foundRecipe.description);
    let ingredients = $("#show-recipe-ingredients");
    ingredients.empty();
    foundRecipe.ingredients.forEach((ingredient) => {
        let nextIngredient = $("<li>");
        nextIngredient.text(ingredient);
        ingredients.append(nextIngredient);
    });
    let instructions = $("#show-recipe-instructions");
    instructions.empty();
    foundRecipe.instructions.forEach((instruction) => {
        let nextInstruction = $("<li>");
        nextInstruction.text(instruction);
        instructions.append(nextInstruction);
    });
    $("#show-recipe").css("display", "flex");
    animate("#show-recipe", {
        opacity: 1,
        duration: 1000,
        ease: "out(3)",
        oncomplete: function(){
            $("nav").css("filter", "blur(5px)");
            $("main").css("filter", "blur(5px)");
            hideBottomNav();
        }
    });
}

$("#close-recipe").on("click", function(){
    animate("#show-recipe", {
        opacity: 0,
        duration: 1000,
        ease: "out(3)",
        oncomplete: function(){
            $("nav").css("filter", "blur(0px)");
            $("main").css("filter", "blur(0px)");
            $("#show-recipe").css("display", "none");
        }
    });
})

/* =========================
   Search
   ========================= */

$("#search").on("click", function(){
    $("#result-display").find("img").each(function(){
        const imageURL = $(this).attr("src");

        if (imageURL && imageURL.startsWith("blob:")) {
            URL.revokeObjectURL(imageURL);
        }
    });
    $("#result-display").empty();

    const recipeInput = $("#recipe-search");
    const recipeToSearch = recipeInput.val().trim().toLowerCase();

    if (recipeToSearch === "") {
        return;
    }

    const wordsToSearch = recipeToSearch.toLowerCase().split(/\s+/);

    const foundRecipes = allRecipes.filter(recipe => {
        return wordsToSearch.some(word =>
            recipe.name.toLowerCase().includes(word) ||

            recipe.description.toLowerCase().includes(word) ||

            recipe.ingredients.some(ingredient =>
                ingredient.toLowerCase().includes(word)
            )
        );
    });

    recipeInput.val("");

    if(foundRecipes.length === 0){
        const errorHeading = $("<h3>");
        errorHeading.text(`No Recipes found containing: ${recipeToSearch}`);
        $("#result-display").append(errorHeading);
    }
    else{
        foundRecipes.forEach((recipe) => {
            let html = `
                <div class="result">
                    <div class="result-description">
                        <h3>${recipe.name}</h3>
                        <p>${recipe.description}</p>
                    </div>
                    <img class="result-img" src="${URL.createObjectURL(recipe.image)}" alt="${recipe.name}">
                </div>
            `
            $("#result-display").append(html);
        })
    }
    $("#recipe-search-results").css("display", "flex");
    animate("#recipe-search-results", {
        opacity: 1,
        duration: 1000,
        ease: "out(3)",
        oncomplete: function(){
            $("nav").css("filter", "blur(5px)");
            $("main").css("filter", "blur(5px)");
            hideBottomNav();
        }
    });
})

function hideRecipeSearchResults(){
    animate("#recipe-search-results", {
        opacity: 0,
        duration: 1000,
        ease: "out(3)",
        oncomplete: function(){
            $("nav").css("filter", "blur(0px)");
            $("main").css("filter", "blur(0px)");
            $("#recipe-search-results").css("display", "none");
        }
    });
}

$("#result-display").on("click", ".result", function(){
    const foundRecipe = allRecipes.find(recipe => recipe.name === $(this).find("h3").text());
    hideRecipeSearchResults();
    showRecipe(foundRecipe);
})

$("#result-close").on("click", function(){
    hideRecipeSearchResults();
})

/* =========================
   Add new recipes
   ========================= */

let recipeError = false;

function closeAddRecipe(){
    animate("#add-new-recipe", {
        opacity: 0,
        duration: 1000,
        ease: "out(3)",
        oncomplete: function(){
            $("nav").css("filter", "blur(0px)");
            $("main").css("filter", "blur(0px)");
            $("#add-new-recipe").css("display", "none");
            recipeError = false;
            location.reload();
        }
    });
}

$("#add-button").on("click", function(){
    $("#add-new-recipe").css("display", "flex");
    animate("#add-new-recipe", {
        opacity: 1,
        duration: 1000,
        ease: "out(3)",
        oncomplete: function(){
            $("nav").css("filter", "blur(5px)");
            $("main").css("filter", "blur(5px)");
            hideBottomNav();
        }
    });
})

$("#recipe-image-button").on("click", function(){
    $("#recipe-image-input").click();
})

function showRecipeError(input){
    input.css("border-color", "red");
    recipeError = true;
}

$("#submit-new-recipe").on("click", async function(){
    recipeError = false;
    const recipeName = $("#new-recipe-name").val();
    const recipeType = $("#new-recipe-type").val();
    const recipeDescription = $("#new-recipe-description").val();
    const recipeIngredients = $("#new-recipe-ingredients").val();
    const recipeInstructions = $("#new-recipe-instructions").val();
    const imageInput = $("#recipe-image-input");

    if(recipeName.trim() === ""){
        showRecipeError($("#new-recipe-name"));
    }
    if (!recipeType){
        showRecipeError($("#new-recipe-type"));
    }
    if(recipeDescription.trim() === ""){
        showRecipeError($("#new-recipe-description"));
    }
    if (recipeIngredients.trim() === ""){
        showRecipeError($("#new-recipe-ingredients"));
    }
    if (recipeInstructions.trim() === ""){
        showRecipeError($("#new-recipe-instructions"));
    }
    if (imageInput[0].files.length === 0){
        showRecipeError($("#recipe-image-button"));
    }

    if(recipeError === true){
        return
    }
    else{
        let newRecipeToAdd = {
            id : crypto.randomUUID(),
            type : recipeType,
            name : recipeName,
            description : recipeDescription,
            ingredients : recipeIngredients.split("\n")
            .map(line => line.trim())
            .filter(line => line !== ""),
            instructions : recipeInstructions.split("\n")
            .map(line => line.trim())
            .filter(line => line !== ""),
            image : $("#recipe-image-input")[0].files[0],
            status : "Pending"
        }

        const addTransaction = db.transaction([STORE_NAME], "readwrite");

        addTransaction.oncomplete = async (event) => {
            console.log("Transaction Complete");
            if (navigator.onLine){
                const synced = await writeToSupabase(newRecipeToAdd);
                if(synced){
                    newRecipeToAdd.status = "Synced";
                }
                else{
                    newRecipeToAdd.status = "Pending";
                }
            }
            else{
                newRecipeToAdd.status = "Pending";
            }

            const updateTransaction = db.transaction([STORE_NAME], "readwrite");

            updateTransaction.oncomplete = (event) => {
                console.log("Transaction Complete");
                readDB("Read");
                closeAddRecipe();
            }

            updateTransaction.onerror = (event) => {
                console.log("Transaction Error");
            }

            let updateObjectStore = updateTransaction.objectStore(STORE_NAME);
            let updateRequest = updateObjectStore.put(newRecipeToAdd);
            updateRequest.onsuccess = (event) => {
                console.log(`${event.target.result} added.`)
            }
        }

        addTransaction.onerror = (event) => {
            console.log("Transaction Error");
        }

        let objectStore = addTransaction.objectStore(STORE_NAME);
        let request = objectStore.add(newRecipeToAdd);
        request.onsuccess = (event) => {
            console.log(`${event.target.result} added.`)
        }
    }
})

$("#recipe-image-input").on("change", function(){
    if (this.files.length === 0){
        return;
    }

    if (oldRecipeURL && oldRecipeURL.startsWith("blob:")) {
        URL.revokeObjectURL(oldRecipeURL);
    }

    const selectedImage = this.files[0];
    const imageURL = URL.createObjectURL(selectedImage);
    oldRecipeURL = imageURL;
    
    $("#recipe-image-preview").attr("src", imageURL).css("display", "block");
    $("#recipe-image-button").css("border", "3px solid #7CD5C7");
})

$("#cancel-recipe").on("click", function(){
    closeAddRecipe();
})