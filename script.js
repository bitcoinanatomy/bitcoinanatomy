// BTCPay Server
if(!window.btcpay){
  var head = document.getElementsByTagName('head')[0];   var script = document.createElement('script');
  script.src='https://btcpay989117.lndyn.com/modal/btcpay.js';
  script.type = 'text/javascript';
  head.append(script);}function onBTCPayFormSubmit(event){
    var xhttp = new XMLHttpRequest();    xhttp.onreadystatechange = function() {
      if (this.readyState == 4 && this.status == 200) {
      if(this.status == 200 && this.responseText){
        var response = JSON.parse(this.responseText);
        window.btcpay.showInvoice(response.invoiceId);
      }
    }
  };
      xhttp.open("POST", event.target.getAttribute('action'), true);
      xhttp.send(new FormData( event.target ));
}





$( document ).ready(function() {


    $("#hero-cta").click(function() {
      $('html, body').animate({
          scrollTop: $("#producership-options").offset().top
      }, 1000);
    });


    $("#team-cta").click(function() {
      $('html, body').animate({
          scrollTop: $("#team").offset().top +10
      }, 500);
    });


    $("#back-to-scenes").click(function() {
      $('html, body').animate({
          scrollTop: $("#scenes").offset().top
      }, 1000);
    });



    $(".popup-toggle").click(function() {
      $("#"+$(this).attr("data-target")).fadeIn(300);
    });

    $(".popup-overlay").click(function(event) {
      e = event || window.event;
      if (e.target == this) {
        $("#"+$(this).attr("data-target")).fadeOut(300);
      }
    });

    $(".popup-close").click(function() {
      $(".popup-overlay").fadeOut(300);
      $('iframe').attr('src', $('iframe').attr('src'));
    });


    $(document).on('keyup', function(e) {
      if (e.key == "Escape") {
        $(".popup-overlay").fadeOut(300);
        $('iframe').attr('src', $('iframe').attr('src'));
      };
    });






  // Hack to force reloading of content from google sheets
  setTimeout(function(){
    getScenesData();
    getProducerData();
    getTeamData();
  }, 500);






  $(".btcpay-form").each(function( index, element ) {

    var jsonForm = new Object();
    var type = $(element).find('.input-checkoutDesc').val();
    $(element).find('.btcpay-input').keyup(function() {

      // limit, for validation
      // {"p":"Contributor","n":"wdhgt735344eew","t":"rwfrw66uiolou3746467456fwwed","g":"546646665644664654"}
      $(element).find('.input-checkoutDesc').val( type + ':' + $(element).find('.input-name').val());
      jsonForm.p = type;
      jsonForm.n = $(element).find('.input-name').val();
      jsonForm.t = $(element).find('.input-twitterHandle').val();
      jsonForm.g = $(element).find('.input-githubUsername').val();
      console.log(JSON.stringify(jsonForm));
      $(element).find('.input-orderId').val(JSON.stringify(jsonForm));
    });

  });

  // Form label animations
  $('input').focus(function(){
    $(this).parents('.form-group').addClass('focused');
  });
  $('input').blur(function(){
    var inputValue = $(this).val();
    if ( inputValue == "" ) {
      $(this).removeClass('filled');
      $(this).parents('.form-group').removeClass('focused');
    } else {
      $(this).addClass('filled');
    }
  });




  const swiper = new Swiper('.swiper-container', {
    loop: true,

    // If we need pagination
    pagination: {
      el: '.swiper-pagination',
    },

    // Navigation arrows
    navigation: {
      nextEl: '.swiper-button-next',
      prevEl: '.swiper-button-prev',
    }
  });





});







function getScenesData(){

  var sceneData = [];
  var shots = [];
  var tableHeader = "<thead><tr> <th class='table-col-section'><h4>Theme</h4></th>   <th class='table-col-board'><h4>Board</h4></th>  <th class='table-col-vo'><h4>Voice</h4></th>  <th class='table-col-visual'><h4>Shot</h4></th> </tr></thead>"

  // JSON export from google docs comes w/ issues. Correct before deplyoing
  var scenes = [
    '01_Prologue.json',
    '02_The_Network.json',
    '03_The_Node.json',
    '04_The_Blockchain.json',
    '05_The_Block.json',
    '06_The_Transaction.json',
    '07_The_Signature.json',
    '08_The_Validation.json',
    '09_Epilogue.json',
  ]


  $.each(scenes, function (key, index) {
      return $.getJSON("scenes/"+index).then(function(data){
        //Add scenes nav


        $("<h4/>", { "data-sort" :  index.substring(0,2).replace(/^0+/, ''), "id": "scene-select-"+index.substring(0,2).replace(/^0+/, ''), "class": "scene-select inactive", html: index.slice(3).replace(/_/g, ' ').slice(0,-5) }).appendTo("#scenes-nav");

        //Add table head
        shots.push(tableHeader);

        //Start table body
        shots.push("<tbody>");

        //Iterate for each shot/row
        $.each( data, function( key, shot ) {

            shots.push( "<tr id='sheet"+index.substring(0,3)+" row-" + key + "' class='row-content'> ");


            var shot_section = '';

            // Section title
            if(shot.section != undefined){
               shots.push( "<td class='table-col-section'><h4>" + shot.section.replace(/\n/g,"<br>") + "</h4></td>");
            }else{
              shots.push( "<td class='table-col-section empty'><h4></h4></td>");
            }


            // Storyboard
            if(shot.board != undefined){
              shots.push( "<td class='table-col-board'>");
              if(shot.board != ""){
                shots.push( "<div class='image-holder'><img src=" + shot.board + " /></div>");
              }
              shots.push( "</td>");
            }else{
              shots.push( "<td class='table-col-board empty'><h4></h4></td>");
            }

            // Voice Over
            if(shot.vo != undefined){
               shots.push( "<td class='table-col-vo'>" + shot.vo.replace(/\n/g,"<br>") + "</td>");
            }else{
              shots.push( "<td class='table-col-vo empty'><h4></h4></td>");
            }

            // Visual d escritpion
            if(shot.visual != undefined){
               shots.push( "<td class='table-col-visual'>" + shot.visual.replace(/\n/g,"<br>") + "</td>");
            }else{
              shots.push( "<td class='table-col-visual empty'><h4></h4></td>");
            }

          shots.push( "</tr>");

        });
        shots.push("</tbody>");

        // Print shots table
        $( "<table/>", { "id": "scene-select-"+index.substring(0,2).replace(/^0+/, '')+"-table" , "class": "scene", html: shots.join( "" ) }).appendTo( "#scenes-data" );
        // Empty shots for next scene
        shots = [];


        // Run only after all scenes loaded
        if(index.substring(0,2).replace(/^0+/, '') >= scenes.length){

          // Sort scene navigation
          var $sorted_items,

          getSorted = function(selector, attrName) {
            return $(
              $(selector).toArray().sort(function(a, b){
                  var aVal = parseInt(a.getAttribute(attrName)),
                      bVal = parseInt(b.getAttribute(attrName));
                  console.log(aVal + ' - ' + bVal + ' = ' + (aVal - bVal) + " | " + a)
                  return aVal - bVal;
              })
            );
          };

          $sorted_items = getSorted('#scenes-nav .scene-select', 'data-sort').clone();
          $('#scenes-nav').html( $sorted_items );

          // Hide and show scenes
          $('.scene').hide();
          $('.scene-select').on('click', function(){
            var t = $(this).attr('id');
            if($(this).hasClass('inactive')){
              $('.scene-select').addClass('inactive');
              $(this).removeClass('inactive');
              $('.scene').hide();
              $('#'+ t + '-table').fadeIn('slow');
           }
           for (i = 1; i <= 10; i++) {
              $('#scenes-diagrams').removeClass('diagram-scene-select-'+i);
           }
           $('#scenes-diagrams').addClass('diagram-'+t);


          });

          $('.scene').hide();
          $('#scene-select-1-table').fadeIn('slow');
          $('#scene-select-1').removeClass('inactive');

        }





      });









  });







}








function getTeamData(){
    var teamData = {};
    var markupTeam = '';
    var department, teamMemberURL, departmentCompensation = "";



    return $.getJSON("team.json").then(function(data){

      $.each(data, function (key, row) {
        if(row.department !== undefined){
              row.department !== undefined ? department = row.department : department = "";
              row.departmentCompensation !== undefined ? departmentCompensation = row.departmentCompensation : departmentCompensation = "";
              teamData[department] = {'departmentName': department, 'departmentCompensation': departmentCompensation, 'team': [] };
        }

        row.url !== undefined ? teamMemberURL = row.url : teamMemberURL = "";

        teamData[department].team.push({
          'name': row.individual.replace(/\n/g,"<br>"),
          'individualCompensation': row.individualCompensation,
          'url': teamMemberURL
        })

      });


      $.each(teamData, function(key, item){
        $.each(item.team, function(key, row){
          if(row.url != ""){
            markupTeam += '<a href="'+row.url+'" target="_blank">' + row.name + '</a> <span class="compensation">' + row.individualCompensation + '%</span><br>';
          }else{
            markupTeam += row.name + ' <span class="compensation">' + row.individualCompensation + '%</span><br>';
          }
        });


        $('#team-data').append('<tr><td class="team-position"><span class="compensation">'+item.departmentCompensation+'%</span> '+item.departmentName+' </td><td class="team-person">'+markupTeam+'</td></tr>');
        markupTeam = "";
      });


    });

};
















function getProducerData(){

    var amoutTotal = 0;

    $.getJSON("https://pvxg.net/BTCpaySponsor/").then(function(data){
       $.each(data, function (key, producer) {
         //console.log(JSON.parse(producer.metadata.orderId));
         //console.log(producer.metadata.itemDesc.startsWith("Contributor:"));

         var targetContainer = "";
         var jsonObject;
         var amount = '<div class="amount">' + producer.amount + ' <span class="grey">' + producer.currency + '</span></div>';
         var currentAmount = parseFloat(producer.amount);



         if(producer.metadata.itemDesc !== undefined && producer.metadata.itemDesc !== null){

                 if(producer.metadata.itemDesc.startsWith("Contributor:")){

                     targetContainer = "#contributors-inner";
                     jsonObject = producer.metadata.orderId;
                     //console.log(jsonObject.t);
                     if(jsonObject.t != ''){
                       $( "<div/>", { "class": "producer-name", html: '<b><a target="_blank" href="https://twitter.com/'+jsonObject.n+'">' + jsonObject.n + '</a></b>' + amount }).appendTo(targetContainer);
                     }else{
                       $( "<div/>", { "class": "producer-name", html: '<b>' + jsonObject.n + '</b>' + amount }).appendTo(targetContainer);
                     }


                     amoutTotal = (currentAmount) + amoutTotal;

                 } else if(producer.metadata.itemDesc.startsWith("Sponsor:")){

                     targetContainer = "#sponsors-inner";
                     jsonObject = producer.metadata.orderId;
                     $( "<div/>", { "class": "producer-name", html:  '<h2>' + jsonObject.n + '</h2>' + amount }).appendTo(targetContainer);

                     amoutTotal = (currentAmount) + amoutTotal;

                 } else if(producer.metadata.itemDesc.startsWith("Producer:")){

                     targetContainer = "#producers-inner";
                     //Adding logos to major contributors
                     if(producer.metadata.itemDesc.startsWith("Producer:PirateHash")){
                       $( "<div/>", { "class": "producer-name", html: '<a href="https://piratehash.com" target="_blank"><img class="producer-logo" src="assets/logos/piratehash.png" /></a>' + amount }).appendTo(targetContainer);
                     }

                     amoutTotal = (currentAmount) + amoutTotal;


                 }
         }
         //reset target
         targetContainer = "";
       });

       var finalProgress = (amoutTotal / 5)*100
       if( finalProgress < 3 ){
         finalProgress = '30px';
         $('.meter').addClass('short');
       }else{
         $('.meter').addClass('long');
         finalProgress = finalProgress+'%';
       }
       $(".amount-value-progress").text(amoutTotal.toFixed(8));
       $( "#meter-progress-bar" ).animate({ width: finalProgress}, 200, function() { });
    });




};




function compare( a, b ) {
  if ( a.sort < b.sort ){
    return -1;
  }
  if ( a.sort > b.sort ){
    return 1;
  }
  return 0;
}
